import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { BackendMonitorInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** Probes flush roughly every 5s; three minutes without a batch marks stale. */
export const ONLINE_THRESHOLD_SECONDS = 180;

/**
 * Presence of the installations sharing one externalRef, normalized for the
 * platform-side per-facility dashboards. Several rows can share a ref (rotation
 * history, multiple instances):
 * - `enrolled` — at least one non-revoked installation exists.
 * - `online` — a non-revoked installation ingested within the online window.
 * - `lastSeenAt` — newest ingest time across the non-revoked installations
 *   (null until the first contact).
 * - `revokedOnly` — rows exist but every one is revoked.
 */
export interface InstallationPresence {
  enrolled: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  revokedOnly: boolean;
}

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

  private withDerivedState(row: BackendMonitorInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string; env?: string; kind?: string }) {
    const token = randomUUID();
    const row = await this.prisma.backendMonitorInstallation.create({
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
    const rows = await this.prisma.backendMonitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  /**
   * Batch presence lookup for platform-side per-facility views:
   * externalRef -> InstallationPresence. One query for the whole set; an
   * externalRef with no installation row at all is absent from the map.
   * Revoked rows are included so the caller can distinguish NOT_ENABLED
   * (no rows) from DISABLED (only revoked rows).
   */
  async getPresenceByExternalRefs(externalRefs: string[]): Promise<Map<string, InstallationPresence>> {
    if (externalRefs.length === 0) return new Map();
    const rows = await this.prisma.backendMonitorInstallation.findMany({
      where: { externalRef: { in: externalRefs } },
      select: { externalRef: true, lastSeenAt: true, revokedAt: true },
    });
    const onlineThresholdMs = ONLINE_THRESHOLD_SECONDS * 1000;
    const now = Date.now();
    const presenceByRef = new Map<string, InstallationPresence>();
    for (const externalRef of externalRefs) {
      const scoped = rows.filter((row) => row.externalRef === externalRef);
      if (scoped.length === 0) continue;
      const active = scoped.filter((row) => !row.revokedAt);
      let lastSeenAt: Date | null = null;
      let online = false;
      for (const row of active) {
        // Any online installation keeps the whole ref online; lastSeenAt is
        // the newest ingest across the non-revoked installations sharing it.
        if (row.lastSeenAt && (!lastSeenAt || row.lastSeenAt > lastSeenAt)) {
          lastSeenAt = row.lastSeenAt;
        }
        if (row.lastSeenAt != null && now - row.lastSeenAt.getTime() <= onlineThresholdMs) {
          online = true;
        }
      }
      presenceByRef.set(externalRef, {
        enrolled: active.length > 0,
        online,
        lastSeenAt,
        revokedOnly: active.length === 0,
      });
    }
    return presenceByRef;
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.backendMonitorInstallation.findUnique({ where: { id } });
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
    await this.prisma.backendMonitorInstallation.update({
      where: { id },
      data: { tokenHash: hashMonitorToken(token) },
    });
    return { id, token };
  }

  /** Soft revocation: ingest is rejected (401), rows are retained. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.backendMonitorInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  /** Token-only authentication for the ingest endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.backendMonitorInstallation.findUnique({
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
      UPDATE "module/backend-monitor"."BackendMonitorInstallation"
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
