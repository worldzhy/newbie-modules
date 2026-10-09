import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { HealthInstallation, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** Requested interval between client snapshots; echoed back in the response. */
export const SNAPSHOT_INTERVAL_SECONDS = 30;

/** Three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = SNAPSHOT_INTERVAL_SECONDS * 3;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

export function hashHealthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Derived health state of an installation. */
export type HealthState = "unknown" | "healthy" | "degraded" | "offline";

/**
 * Installation registry for the health module. One token = one running
 * deployment endpoint; the host pre-creates rows and distributes the
 * plaintext token out of band, and the running process posts a dependency
 * health snapshot periodically.
 *
 * Unlike heartbeat (pure liveness), health stores the latest snapshot
 * (aggregated status + per-indicator results) and derives a richer state
 * (unknown / healthy / degraded / offline) at read time.
 */
@Injectable()
export class HealthInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Installation lifecycle (host integration API)
  // -------------------------------------------------------------------------

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string }) {
    const token = randomUUID();
    const row = await this.prisma.healthInstallation.create({
      data: {
        label: input.label,
        externalRef: input.externalRef ?? null,
        tokenHash: hashHealthToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.healthInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.healthInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string) {
    const token = randomUUID();
    try {
      await this.prisma.healthInstallation.update({
        where: { id },
        data: { tokenHash: hashHealthToken(token) },
      });
    } catch (error) {
      if (this.isMissingRowError(error)) {
        throw new NotFoundException(`Installation ${id} not found.`);
      }
      throw error;
    }
    return { id, token };
  }

  /** Soft revocation: snapshots are rejected (401), rows retained for audit. */
  async revoke(id: string) {
    try {
      await this.prisma.healthInstallation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
    } catch (error) {
      if (this.isMissingRowError(error)) {
        throw new NotFoundException(`Installation ${id} not found.`);
      }
      throw error;
    }
    return { id, revoked: true };
  }

  // -------------------------------------------------------------------------
  // Health state queries
  // -------------------------------------------------------------------------

  /**
   * Batch health-state lookup for host-side list views: externalRef -> state.
   * One query for the whole set; an externalRef with no installation (or none
   * at all) is simply absent from the map.
   */
  async getHealthByExternalRefs(externalRefs: string[]): Promise<Map<string, HealthState>> {
    if (externalRefs.length === 0) return new Map();
    const rows = await this.prisma.healthInstallation.findMany({
      where: { externalRef: { in: externalRefs }, revokedAt: null },
      select: { externalRef: true, lastSnapshotAt: true, lastSnapshotStatus: true },
    });
    const states = new Map<string, HealthState>();
    for (const row of rows) {
      if (!row.externalRef) continue;
      const state = this.deriveState(row.lastSnapshotAt, row.lastSnapshotStatus);
      const prev = states.get(row.externalRef);
      // "worse" state wins across multiple installations sharing an externalRef.
      states.set(row.externalRef, prev ? this.worseState(prev, state) : state);
    }
    return states;
  }

  /**
   * Return installations whose latest snapshot shows errors or that have
   * stopped reporting. Used by the health monitor / alerting.
   */
  async findUnhealthyInstallations(): Promise<
    Array<{
      id: string;
      label: string;
      env: string | null;
      instanceId: string | null;
      appVersion: string | null;
      state: HealthState;
      lastSnapshotAt: Date | null;
      lastSnapshotStatus: string | null;
      lastSnapshotInfo: unknown;
    }>
  > {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MILLISECONDS);
    const rows = await this.prisma.healthInstallation.findMany({
      where: {
        revokedAt: null,
        OR: [
          { lastSnapshotStatus: "error" },
          { lastSnapshotAt: { not: null, lt: cutoff } },
          { lastSnapshotAt: null },
        ],
      },
      select: {
        id: true,
        label: true,
        env: true,
        instanceId: true,
        appVersion: true,
        lastSnapshotAt: true,
        lastSnapshotStatus: true,
        lastSnapshotInfo: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      state: this.deriveState(row.lastSnapshotAt, row.lastSnapshotStatus),
    }));
  }

  // -------------------------------------------------------------------------
  // Snapshot ingest
  // -------------------------------------------------------------------------

  /**
   * Authenticate a snapshot and persist it in a single round trip: the
   * token hash and the revocation check live in the UPDATE's WHERE clause.
   * Returns false for an unknown or revoked token so callers respond 401;
   * the two cases are intentionally indistinguishable.
   *
   * firstSeenAt is written exactly once (COALESCE), lastSeenAt always
   * advances, runtime facts and snapshot refresh on every report.
   */
  async recordSnapshot(
    token: string,
    facts: {
      appVersion?: string;
      env?: string;
      instanceId?: string;
      status: string;
      info: Record<string, { status: string; message?: string }>;
    },
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "module/health"."HealthInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "lastSnapshotStatus" = ${facts.status},
          "lastSnapshotInfo" = ${JSON.stringify(facts.info)}::jsonb,
          "lastSnapshotAt" = ${now},
          "updatedAt" = ${now}
      WHERE "tokenHash" = ${hashHealthToken(token)}
        AND "revokedAt" IS NULL
      RETURNING "id"
    `;
    return rows.length === 1;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private deriveState(lastSnapshotAt: Date | null, lastSnapshotStatus: string | null): HealthState {
    if (!lastSnapshotAt) return "unknown";
    const stale = Date.now() - lastSnapshotAt.getTime() > ONLINE_THRESHOLD_MILLISECONDS;
    if (stale) return "offline";
    return lastSnapshotStatus === "ok" ? "healthy" : "degraded";
  }

  private worseState(a: HealthState, b: HealthState): HealthState {
    const order: Record<HealthState, number> = { unknown: 0, healthy: 1, degraded: 2, offline: 3 };
    return order[a] >= order[b] ? a : b;
  }

  private withDerivedState(row: HealthInstallation) {
    const state = this.deriveState(row.lastSnapshotAt, row.lastSnapshotStatus);
    const { tokenHash, ...rest } = row;
    return { ...rest, state };
  }

  private isMissingRowError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
  }
}
