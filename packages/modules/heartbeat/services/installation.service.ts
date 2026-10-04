import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { HeartbeatInstallation, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** Requested interval between client pings; echoed back in the ping response. */
export const PING_INTERVAL_SECONDS = 30;

/** Three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = PING_INTERVAL_SECONDS * 3;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

export function hashHeartbeatToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Installation registry for the heartbeat module. One token = one deployment
 * endpoint; the host pre-creates rows and distributes the plaintext token out
 * of band, and the running process touches lastSeenAt on every ping.
 */
@Injectable()
export class HeartbeatInstallationService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Installation lifecycle (host integration API)
  // -------------------------------------------------------------------------

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string }) {
    const token = randomUUID();
    const row = await this.prisma.heartbeatInstallation.create({
      data: {
        label: input.label,
        externalRef: input.externalRef ?? null,
        tokenHash: hashHeartbeatToken(token),
      },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.heartbeatInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.heartbeatInstallation.findUnique({ where: { id } });
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
      await this.prisma.heartbeatInstallation.update({
        where: { id },
        data: { tokenHash: hashHeartbeatToken(token) },
      });
    } catch (error) {
      if (this.isMissingRowError(error)) {
        throw new NotFoundException(`Installation ${id} not found.`);
      }
      throw error;
    }
    return { id, token };
  }

  /** Soft revocation: pings are rejected (401), rows are retained for audit. */
  async revoke(id: string) {
    try {
      await this.prisma.heartbeatInstallation.update({
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
  // Liveness queries
  // -------------------------------------------------------------------------

  /**
   * Batch liveness lookup for host-side list views: externalRef -> online.
   * One query for the whole set; an externalRef with no online installation
   * (or none at all) is simply absent from the map.
   */
  async getOnlineByExternalRefs(externalRefs: string[]): Promise<Map<string, boolean>> {
    if (externalRefs.length === 0) return new Map();
    const rows = await this.prisma.heartbeatInstallation.findMany({
      where: { externalRef: { in: externalRefs }, revokedAt: null },
      select: { externalRef: true, lastSeenAt: true },
    });
    const online = new Map<string, boolean>();
    const now = Date.now();
    for (const row of rows) {
      if (!row.externalRef || !row.lastSeenAt) continue;
      const isOnline = now - row.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
      online.set(row.externalRef, (online.get(row.externalRef) ?? false) || isOnline);
    }
    return online;
  }

  /**
   * Return installations that have stopped pinging: not revoked, have been
   * seen at least once, and whose lastSeenAt is older than the online
   * threshold. The returned shape carries the self-reported runtime facts so
   * callers (e.g. notification wiring) can render a useful alert without
   * issuing a second query.
   */
  async findOfflineInstallations(): Promise<
    Array<{
      id: string;
      label: string;
      env: string | null;
      instanceId: string | null;
      appVersion: string | null;
      lastSeenAt: Date;
    }>
  > {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MILLISECONDS);
    const rows = await this.prisma.heartbeatInstallation.findMany({
      where: {
        revokedAt: null,
        lastSeenAt: { not: null, lt: cutoff },
      },
      select: {
        id: true,
        label: true,
        env: true,
        instanceId: true,
        appVersion: true,
        lastSeenAt: true,
      },
    });
    // The where clause guarantees lastSeenAt is non-null; Prisma's type does
    // not narrow on the `not: null` condition, so filter defensively.
    return rows.filter((row): row is typeof row & { lastSeenAt: Date } => row.lastSeenAt !== null);
  }

  // -------------------------------------------------------------------------
  // Ping ingest
  // -------------------------------------------------------------------------

  /**
   * Authenticate a ping and advance liveness in a single round trip: the
   * token hash and the revocation check live in the UPDATE's WHERE clause.
   * Returns false for an unknown or revoked token so callers respond 401;
   * the two cases are intentionally indistinguishable.
   *
   * firstSeenAt is written exactly once (COALESCE), lastSeenAt always
   * advances, runtime facts refresh when sent.
   */
  async recordPing(
    token: string,
    facts: {
      appVersion?: string;
      env?: string;
      instanceId?: string;
    },
  ): Promise<boolean> {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "module/heartbeat"."HeartbeatInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "updatedAt" = ${now}
      WHERE "tokenHash" = ${hashHeartbeatToken(token)}
        AND "revokedAt" IS NULL
      RETURNING "id"
    `;
    return rows.length === 1;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private withDerivedState(row: HeartbeatInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - row.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
    const { tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  private isMissingRowError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
  }
}
