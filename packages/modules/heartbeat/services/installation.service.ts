import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** Clients ping every 30s; three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = 90;

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

  private withDerivedState(row: any) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash, ...rest } = row;
    return { ...rest, online };
  }

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
    for (const row of rows) {
      if (!row.externalRef || !row.lastSeenAt) continue;
      const isOnline = Date.now() - row.lastSeenAt.getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
      online.set(row.externalRef, (online.get(row.externalRef) ?? false) || isOnline);
    }
    return online;
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
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.heartbeatInstallation.update({
      where: { id },
      data: { tokenHash: hashHeartbeatToken(token) },
    });
    return { id, token };
  }

  /** Soft revocation: pings are rejected (401), rows are retained for audit. */
  async revoke(id: string) {
    await this.getOrThrow(id);
    await this.prisma.heartbeatInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true };
  }

  /** Token-only authentication for the ping endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.heartbeatInstallation.findUnique({
      where: { tokenHash: hashHeartbeatToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Liveness touch on every ping: firstSeenAt is written exactly once
   * (COALESCE), lastSeenAt always advances, runtime facts refresh when sent.
   */
  async touchOnPing(
    id: string,
    facts: {
      appVersion?: string;
      env?: string;
      instanceId?: string;
    },
  ) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/heartbeat"."HeartbeatInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
