import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** An installation polls every 60s; three missed intervals marks it offline. */
export const ONLINE_THRESHOLD_SECONDS = 180;

export function hashInstallationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Installation registry. One token = one installation instance; the host
 * pre-creates rows and distributes the plaintext token out of band, the CLI
 * self-registers runtime facts on its first poll.
 */
@Injectable()
export class ModuleHubInstallationService {
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
  async create(input: { label: string; repoUrl?: string; externalRef?: string; actor?: string }) {
    const token = randomUUID();
    const row = await this.prisma.hubInstallation.create({
      data: {
        label: input.label,
        repoUrl: input.repoUrl ?? null,
        externalRef: input.externalRef ?? null,
        tokenHash: hashInstallationToken(token),
      },
    });
    await this.audit(row.id, "installation.enroll", `host:${input.actor ?? "unknown"}`, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.hubInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.hubInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Latest module snapshot reported by the agent (`newbie status --json`). */
  async getModules(id: string) {
    const row = await this.getOrThrow(id);
    return row.modulesSnapshot ?? null;
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.hubInstallation.update({
      where: { id },
      data: { tokenHash: hashInstallationToken(token) },
    });
    await this.audit(id, "installation.rotate", `host:${actor ?? "unknown"}`);
    return { id, token };
  }

  /** Soft revocation: polls are rejected, rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    await this.prisma.hubInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit(id, "installation.revoke", `host:${actor ?? "unknown"}`);
    return { id, revoked: true };
  }

  /** Token-only authentication for the agent poll endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.hubInstallation.findUnique({
      where: { tokenHash: hashInstallationToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /** Self-registration of runtime facts on every poll. */
  async touchOnPoll(id: string, facts: { cliVersion: string; status: any }) {
    const now = new Date();
    const registrySourceCommit =
      facts.status?.registry?.available && typeof facts.status.registry.sourceCommit === "string"
        ? facts.status.registry.sourceCommit
        : null;
    // firstSeenAt is written exactly once (COALESCE); everything else refreshes.
    await this.prisma.$executeRaw`
      UPDATE "module/module-hub"."HubInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "newbieVersion" = ${facts.cliVersion},
          "registrySourceCommit" = ${registrySourceCommit},
          "modulesSnapshot" = ${JSON.stringify(facts.status)}::jsonb,
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }

  async audit(installationId: string | null, action: string, actor: string, detail?: any) {
    await this.prisma.hubAuditLog.create({
      data: { installationId, action, actor, detail: detail ?? undefined },
    });
  }
}
