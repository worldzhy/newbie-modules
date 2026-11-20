import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  PENETRATION_TESTING_TEST_OBJECT_KINDS,
  type PenetrationTestingTestObjectKind,
} from "../penetration-testing.constants";

export interface CreatePenetrationTestingTestObjectInput {
  subjectId: string;
  kind: PenetrationTestingTestObjectKind;
  /** Playbook scope, e.g. { table: "orders", id: "..." }. */
  locator: Record<string, unknown>;
  cleanupLocator?: Record<string, unknown>;
  disposable: boolean;
  createdBy: string;
  expiresAt: Date;
}

export interface PenetrationTestingTestObjectRecord {
  id: string;
  subjectId: string;
  kind: PenetrationTestingTestObjectKind;
  locator: Record<string, unknown>;
  cleanupLocator: Record<string, unknown> | null;
  disposable: boolean;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  expiresAt: Date;
}

/**
 * PenetrationTestingTestObjectService — the object half of the L4 gate
 * (ADR-075 §2, §3).
 *
 * An L4 playbook can only destroy an object that a second operator approved as
 * disposable, that has not expired, and that matches the playbook's object kind.
 * Registration and approval are deliberately separate, like the authorization
 * itself.
 */
@Injectable()
export class PenetrationTestingTestObjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePenetrationTestingTestObjectInput): Promise<PenetrationTestingTestObjectRecord> {
    const kind = requireKind(input.kind);
    const createdBy = requireOperator(input.createdBy, "createdBy");
    requireLocator(input.locator, "locator");
    if (input.cleanupLocator !== undefined) requireLocator(input.cleanupLocator, "cleanupLocator");
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
      throw new BadRequestException("expiresAt must be a valid date.");
    }
    if (input.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("expiresAt must be in the future.");
    }

    const row = await this.prisma.penetrationTestingTestObject.create({
      data: {
        subjectId: input.subjectId,
        kind,
        locator: input.locator as Prisma.InputJsonValue,
        ...(input.cleanupLocator !== undefined
          ? { cleanupLocator: input.cleanupLocator as Prisma.InputJsonValue }
          : {}),
        disposable: input.disposable,
        createdBy,
        expiresAt: input.expiresAt,
      },
    });
    return toTestObjectRecord(row);
  }

  async approve(id: string, approvedBy: string): Promise<PenetrationTestingTestObjectRecord> {
    const operator = requireOperator(approvedBy, "approvedBy");
    const row = await this.findOrThrow(id);
    if (row.approvedAt) {
      throw new BadRequestException(`Test object ${id} is already approved.`);
    }
    if (row.createdBy === operator) {
      throw new ForbiddenException("The registrant cannot approve their own test object (separation of duties).");
    }
    if (!row.disposable) {
      throw new BadRequestException("A test object must be marked disposable before it can be approved for L4.");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("A test object must not be expired when it is approved.");
    }
    const updated = await this.prisma.penetrationTestingTestObject.update({
      where: { id },
      data: { approvedBy: operator, approvedAt: new Date() },
    });
    return toTestObjectRecord(updated);
  }

  async list(subjectId: string): Promise<PenetrationTestingTestObjectRecord[]> {
    const rows = await this.prisma.penetrationTestingTestObject.findMany({
      where: { subjectId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toTestObjectRecord);
  }

  /**
   * The gate query: by id, owned by the subject, of the playbook's kind,
   * disposable, approved and unexpired. Null means the L4 gate must refuse.
   */
  async findApprovedForGate(
    id: string,
    subjectId: string,
    kind: PenetrationTestingTestObjectKind,
    now: Date,
  ): Promise<PenetrationTestingTestObjectRecord | null> {
    const row = await this.prisma.penetrationTestingTestObject.findFirst({
      where: {
        id,
        subjectId,
        kind,
        disposable: true,
        approvedAt: { not: null },
        expiresAt: { gt: now },
      },
    });
    return row ? toTestObjectRecord(row) : null;
  }

  private async findOrThrow(id: string) {
    const row = await this.prisma.penetrationTestingTestObject.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Penetration testing test object ${id} not found`);
    return row;
  }
}

function requireKind(value: string): PenetrationTestingTestObjectKind {
  if (!(PENETRATION_TESTING_TEST_OBJECT_KINDS as readonly string[]).includes(value)) {
    throw new BadRequestException(
      `Test object kind '${value}' is not supported; expected ${PENETRATION_TESTING_TEST_OBJECT_KINDS.join(", ")}.`,
    );
  }
  return value as PenetrationTestingTestObjectKind;
}

function requireOperator(value: string, field: string): string {
  const operator = value?.trim();
  if (!operator) throw new BadRequestException(`${field} is required.`);
  return operator;
}

function requireLocator(value: Record<string, unknown>, field: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new BadRequestException(`${field} must be a non-empty object.`);
  }
}

function toTestObjectRecord(row: {
  id: string;
  subjectId: string;
  kind: string;
  locator: Prisma.JsonValue;
  cleanupLocator: Prisma.JsonValue;
  disposable: boolean;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  expiresAt: Date;
}): PenetrationTestingTestObjectRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    kind: row.kind as PenetrationTestingTestObjectKind,
    locator: asObject(row.locator),
    cleanupLocator: row.cleanupLocator ? asObject(row.cleanupLocator) : null,
    disposable: row.disposable,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    expiresAt: row.expiresAt,
  };
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
