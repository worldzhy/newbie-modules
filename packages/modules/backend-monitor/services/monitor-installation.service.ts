import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** Probes flush roughly every 5s; three minutes without a batch marks stale. */
export const ONLINE_THRESHOLD_SECONDS = 180;

export function hashMonitorToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Registry of backend-monitor deployment endpoints (module-hub design §9.2,
 * Phase 3 pilot). One token = one installation; the running process presents
 * it as X-Backend-Monitor-Token on /backend-monitor/ingest.
 *
 * Mirrors the hub/heartbeat installation pattern (random UUID token, SHA-256
 * hash, one-time plaintext return, soft revocation) by copying the code rather
 * than sharing a runtime dependency, per registry module philosophy.
 */
@Injectable()
export class MonitorInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  private withDerivedState(row: any) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string; env?: string; kind?: string }) {
    const token = randomUUID();
    const row = await this.prisma.monitorInstallation.create({
      data: {
        label: input.label,
        externalRef: input.externalRef ?? null,
        env: input.env ?? null,
        kind: input.kind ?? null,
        tokenHash: hashMonitorToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.monitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.monitorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Monitor installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string) {
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.monitorInstallation.update({
      where: { id },
      data: { tokenHash: hashMonitorToken(token) },
    });
    return { id, token };
  }

  /** Soft revocation: ingest is rejected (401), rows are retained. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.monitorInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  /** Token-only authentication for the ingest endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.monitorInstallation.findUnique({
      where: { tokenHash: hashMonitorToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Refresh liveness and self-reported facts on ingest. firstSeenAt is written
   * once (COALESCE); fact columns keep the latest non-null value. Called by
   * the resolver under a write throttle — ingest is high-volume.
   */
  async touchOnIngest(
    id: string,
    facts: {
      env?: string;
      appVersion?: string;
      instanceId?: string;
      kind?: string;
    },
  ) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/backend-monitor"."MonitorInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "kind" = COALESCE(${facts.kind ?? null}, "kind"),
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
