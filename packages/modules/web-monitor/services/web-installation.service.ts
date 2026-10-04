import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { func } from "../shared/utils";

/** Reports flush near-continuously; three minutes without one marks stale. */
export const ONLINE_THRESHOLD_SECONDS = 180;

export function hashWebToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Registry of web-monitor browser-SDK installations. One token = one FRONTEND
 * application reporting to /api/v1/report/web with the token in the body.
 *
 * Mirrors the hub/heartbeat/backend-monitor installation pattern (random UUID
 * token, SHA-256 hash, one-time plaintext return, soft revocation) by copying
 * the code rather than sharing a runtime dependency, per registry module
 * philosophy. Replaces the retired application.Agent (WEB_MONITOR) identity.
 */
@Injectable()
export class WebInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  private withDerivedState(row: any) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /**
   * Enroll a new installation. The plaintext token and the generated appKey
   * are returned ONCE; appKey is immutable across rotations because it is
   * embedded in Mongo collection / ClickHouse table names.
   */
  async create(input: { label: string; externalRef?: string }) {
    const token = randomUUID();
    // func.randomString appends Date.now(); keep only the leading random part.
    const appKey = func.randomString(7).slice(0, 7);
    const row = await this.prisma.webMonitorInstallation.create({
      data: {
        label: input.label,
        externalRef: input.externalRef ?? null,
        appKey,
        tokenHash: hashWebToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.webMonitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.webMonitorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Web installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Exact-match lookup by the host-mapping tag ("projectId/applicationId"). */
  async findByExternalRef(externalRef: string) {
    return this.prisma.webMonitorInstallation.findFirst({ where: { externalRef } });
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string) {
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.webMonitorInstallation.update({
      where: { id },
      data: { tokenHash: hashWebToken(token) },
    });
    return { id, token };
  }

  /** Soft revocation: reports are rejected (401), rows are retained. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.webMonitorInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  /** Re-enable a revoked installation by clearing the revocation marker. */
  async unrevoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.webMonitorInstallation.update({ where: { id }, data: { revokedAt: null } });
    return { id, revoked: false };
  }

  /** Token-only authentication for the report endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.webMonitorInstallation.findUnique({
      where: { tokenHash: hashWebToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Refresh liveness on report. firstSeenAt is written once (COALESCE).
   * Called by the resolver under a write throttle — reporting is high-volume.
   */
  async touchOnReport(id: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/web-monitor"."WebMonitorInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
