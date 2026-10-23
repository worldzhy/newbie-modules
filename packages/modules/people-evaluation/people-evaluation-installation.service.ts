import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationCollectorInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** A collector that has not reported for this long is shown as offline. */
export const COLLECTOR_ONLINE_THRESHOLD_SECONDS = 180;

export function hashCollectorToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Enrollment registry for member-side work collectors (ADR-029).
 *
 * Same contract as the backend-monitor installation: one random UUID token per
 * installation, stored only as a SHA-256 hash, plaintext returned exactly once,
 * soft revocation (rows retained). The row pins the member the token may report
 * for, so a leaked token cannot write evidence for another member.
 */
@Injectable()
export class PeopleEvaluationInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  private withDerivedState(row: PeopleEvaluationCollectorInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= COLLECTOR_ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll a collector installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; memberUserId: string; hostname?: string }) {
    const token = randomUUID();
    const row = await this.prisma.peopleEvaluationCollectorInstallation.create({
      data: {
        label: input.label,
        memberUserId: input.memberUserId,
        hostname: input.hostname ?? null,
        tokenHash: hashCollectorToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { memberUserId?: string }) {
    const rows = await this.prisma.peopleEvaluationCollectorInstallation.findMany({
      where: query.memberUserId ? { memberUserId: query.memberUserId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.peopleEvaluationCollectorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Collector installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string) {
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.peopleEvaluationCollectorInstallation.update({
      where: { id },
      data: { tokenHash: hashCollectorToken(token) },
    });
    return { id, token };
  }

  /** Soft revocation: ingest is rejected (401), reported rows are retained. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.peopleEvaluationCollectorInstallation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { id, revoked: true };
  }

  /** Token-only authentication for the ingest endpoints. */
  async resolveByToken(token: string) {
    const row = await this.prisma.peopleEvaluationCollectorInstallation.findUnique({
      where: { tokenHash: hashCollectorToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /** Refresh liveness on ingest. firstSeenAt is written once. */
  async touchOnIngest(id: string, hostname?: string) {
    const now = new Date();
    await this.prisma.peopleEvaluationCollectorInstallation.update({
      where: { id },
      data: {
        firstSeenAt: (await this.getOrThrow(id)).firstSeenAt ?? now,
        lastSeenAt: now,
        hostname: hostname ?? undefined,
      },
    });
  }
}
