import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationInstallation, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreatePeopleEvaluationInstallationRequestDto,
  PeopleEvaluationInstallationCredentialResponseDto,
} from "./people-evaluation.dto";

/** An installation agent that has not reported for this long is shown as offline. */
export const PEOPLE_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS = 180;

/** Database schema for the people-evaluation module (mirrors prisma @@schema). */
const PEOPLE_EVALUATION_SCHEMA = "module/people-evaluation";

export function hashPeopleEvaluationInstallationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Enrollment registry for member-side installation agents (ADR-029).
 *
 * Same contract as the backend-monitor installation: one random UUID token per
 * installation, stored only as a SHA-256 hash, plaintext returned exactly once,
 * soft revocation (rows retained). The row pins the evaluatee the token may
 * report for, so a leaked token cannot write evidence for another member.
 */
@Injectable()
export class PeopleEvaluationInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  private withDerivedState(row: PeopleEvaluationInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= PEOPLE_EVALUATION_INSTALLATION_ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll an installation. The plaintext token is returned ONCE. */
  async create(
    input: CreatePeopleEvaluationInstallationRequestDto,
  ): Promise<PeopleEvaluationInstallationCredentialResponseDto> {
    const token = randomUUID();
    const row = await this.prisma.peopleEvaluationInstallation.create({
      data: {
        label: input.label,
        evaluateeUserId: input.evaluateeUserId,
        hostname: input.hostname ?? null,
        tokenHash: hashPeopleEvaluationInstallationToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { evaluateeUserId?: string }) {
    const rows = await this.prisma.peopleEvaluationInstallation.findMany({
      where: query.evaluateeUserId ? { evaluateeUserId: query.evaluateeUserId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.peopleEvaluationInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string): Promise<PeopleEvaluationInstallationCredentialResponseDto> {
    await this.getOrThrow(id);
    const token = randomUUID();
    const row = await this.prisma.peopleEvaluationInstallation.update({
      where: { id },
      data: { tokenHash: hashPeopleEvaluationInstallationToken(token) },
    });
    return { ...this.withDerivedState(row), token };
  }

  /** Soft revocation: ingest is rejected (401), reported rows are retained. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.peopleEvaluationInstallation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { id, revoked: true };
  }

  /** Token-only authentication for the ingest endpoints. */
  async resolveByToken(token: string) {
    const row = await this.prisma.peopleEvaluationInstallation.findUnique({
      where: { tokenHash: hashPeopleEvaluationInstallationToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Refresh liveness on ingest in a single statement: firstSeenAt is set once
   * (COALESCE), lastSeenAt always moves forward. One round trip, no read first.
   */
  async touchOnIngest(id: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ${Prisma.raw(`"${PEOPLE_EVALUATION_SCHEMA}"."PeopleEvaluationInstallation"`)}
      SET "firstSeenAt" = COALESCE("firstSeenAt", NOW()),
          "lastSeenAt" = NOW()
      WHERE "id" = ${id}::uuid
    `;
  }
}
