import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { PENETRATION_TESTING_LEVELS, type PenetrationTestingLevel } from "../penetration-testing.constants";

export interface PenetrationTestingMaintenanceWindow {
  start: string;
  end: string;
  timezone: string;
}

export interface RequestPenetrationTestingAuthorizationInput {
  subjectId: string;
  level: PenetrationTestingLevel;
  roeDocumentRef: string;
  scopeNote?: string;
  requestedBy: string;
  validFrom?: Date;
  validUntil: Date;
  allowedCidrs?: string[];
  /** L3 only: the finding being verified. */
  findingId?: string;
  /** L3 only: the one attack class allowed. */
  attackClass?: string;
  /** L4 only: the window the action may run in. */
  maintenanceWindow?: PenetrationTestingMaintenanceWindow;
}

export interface PenetrationTestingAuthorizationRecord {
  id: string;
  subjectId: string;
  level: PenetrationTestingLevel;
  status: string;
  roeDocumentRef: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  validFrom: Date;
  validUntil: Date;
  allowedCidrs: string[];
  findingId: string | null;
  attackClass: string | null;
  maintenanceWindow: PenetrationTestingMaintenanceWindow | null;
}

/**
 * PenetrationTestingAuthorizationService — the written-authorization half of the
 * three-layer gate (ADR-075 §4).
 *
 * Separation of duties is enforced here, not in the UI: `requestedBy` and
 * `approvedBy` must differ, and a request can only move PENDING → APPROVED.
 * The gate never trusts the run config: it reloads an approved, in-window row by
 * subject and level on every run.
 */
@Injectable()
export class PenetrationTestingAuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async request(input: RequestPenetrationTestingAuthorizationInput): Promise<PenetrationTestingAuthorizationRecord> {
    const level = requireLevel(input.level);
    const requestedBy = requireOperator(input.requestedBy, "requestedBy");
    const roeDocumentRef = input.roeDocumentRef?.trim();
    if (!roeDocumentRef) {
      throw new BadRequestException(
        "roeDocumentRef is required; keep the signed document in the host document system.",
      );
    }
    const validFrom = input.validFrom ?? new Date();
    if (!(input.validUntil instanceof Date) || Number.isNaN(input.validUntil.getTime())) {
      throw new BadRequestException("validUntil must be a valid date.");
    }
    if (input.validUntil.getTime() <= validFrom.getTime()) {
      throw new BadRequestException("validUntil must be after validFrom.");
    }
    if (level === "L3" && (!input.findingId || !input.attackClass?.trim())) {
      throw new BadRequestException("L3 authorization requires both findingId and attackClass.");
    }
    if (level !== "L3" && (input.findingId || input.attackClass)) {
      throw new BadRequestException("findingId and attackClass are only valid for L3 authorizations.");
    }
    if (level === "L4" && !input.maintenanceWindow) {
      throw new BadRequestException("L4 authorization requires a maintenanceWindow.");
    }
    if (level !== "L4" && input.maintenanceWindow) {
      throw new BadRequestException("maintenanceWindow is only valid for L4 authorizations.");
    }

    const row = await this.prisma.penetrationTestingAuthorization.create({
      data: {
        subjectId: input.subjectId,
        level,
        roeDocumentRef,
        scopeNote: input.scopeNote?.trim() || null,
        requestedBy,
        validFrom,
        validUntil: input.validUntil,
        allowedCidrs: normalizeCidrs(input.allowedCidrs),
        findingId: input.findingId ?? null,
        attackClass: input.attackClass?.trim() || null,
        ...(input.maintenanceWindow
          ? { maintenanceWindow: input.maintenanceWindow as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toAuthorizationRecord(row);
  }

  async approve(id: string, approvedBy: string): Promise<PenetrationTestingAuthorizationRecord> {
    const operator = requireOperator(approvedBy, "approvedBy");
    const row = await this.findOrThrow(id);
    if (row.status !== "PENDING") {
      throw new BadRequestException(`Authorization ${id} is ${row.status}; only PENDING can be approved.`);
    }
    if (row.requestedBy === operator) {
      throw new ForbiddenException("The requester cannot approve their own authorization (separation of duties).");
    }
    const updated = await this.prisma.penetrationTestingAuthorization.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: operator, approvedAt: new Date() },
    });
    return toAuthorizationRecord(updated);
  }

  async revoke(id: string, revokedBy: string, reason: string): Promise<PenetrationTestingAuthorizationRecord> {
    const operator = requireOperator(revokedBy, "revokedBy");
    const note = reason?.trim();
    if (!note) throw new BadRequestException("A revoke reason is required.");
    const row = await this.findOrThrow(id);
    if (row.status === "REVOKED") return toAuthorizationRecord(row);
    const updated = await this.prisma.penetrationTestingAuthorization.update({
      where: { id },
      data: { status: "REVOKED", revokedAt: new Date(), revokeReason: `${note} (by ${operator})` },
    });
    return toAuthorizationRecord(updated);
  }

  /**
   * Reload the approved row the gate is allowed to use. Date bounds are checked
   * in the gate so it can report a precise reason; this query only requires an
   * approved row for the subject and level.
   */
  async findApproved(
    subjectId: string,
    level: PenetrationTestingLevel,
  ): Promise<PenetrationTestingAuthorizationRecord | null> {
    const row = await this.prisma.penetrationTestingAuthorization.findFirst({
      where: { subjectId, level, status: "APPROVED" },
      orderBy: { approvedAt: "desc" },
    });
    return row ? toAuthorizationRecord(row) : null;
  }

  async findById(id: string): Promise<PenetrationTestingAuthorizationRecord | null> {
    const row = await this.prisma.penetrationTestingAuthorization.findUnique({ where: { id } });
    return row ? toAuthorizationRecord(row) : null;
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.penetrationTestingAuthorization.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Penetration testing authorization ${id} not found`);
    return row;
  }
}

function requireLevel(value: string): PenetrationTestingLevel {
  if (!(PENETRATION_TESTING_LEVELS as readonly string[]).includes(value)) {
    throw new BadRequestException(
      `Level '${value}' is not supported; expected ${PENETRATION_TESTING_LEVELS.join(", ")}.`,
    );
  }
  return value as PenetrationTestingLevel;
}

function requireOperator(value: string, field: string): string {
  const operator = value?.trim();
  if (!operator) throw new BadRequestException(`${field} is required.`);
  return operator;
}

function normalizeCidrs(input?: string[]): string[] {
  if (!input?.length) return [];
  return [...new Set(input.map((cidr) => cidr.trim()).filter(Boolean))];
}

function toAuthorizationRecord(row: {
  id: string;
  subjectId: string;
  level: string;
  status: string;
  roeDocumentRef: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  validFrom: Date;
  validUntil: Date;
  allowedCidrs: string[];
  findingId: string | null;
  attackClass: string | null;
  maintenanceWindow: Prisma.JsonValue;
}): PenetrationTestingAuthorizationRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    level: row.level as PenetrationTestingLevel,
    status: row.status,
    roeDocumentRef: row.roeDocumentRef,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    allowedCidrs: row.allowedCidrs,
    findingId: row.findingId,
    attackClass: row.attackClass,
    maintenanceWindow: parseMaintenanceWindow(row.maintenanceWindow),
  };
}

function parseMaintenanceWindow(value: Prisma.JsonValue): PenetrationTestingMaintenanceWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.start !== "string" || typeof record.end !== "string" || typeof record.timezone !== "string") {
    return null;
  }
  return { start: record.start, end: record.end, timezone: record.timezone };
}
