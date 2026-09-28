import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/** An installation reports every 60s; three missed intervals marks it offline (design §4.2). */
export const ONLINE_THRESHOLD_SECONDS = 180;

export function hashInstallationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Installation registry. One token = one installation instance; the host
 * pre-creates rows and distributes the plaintext report token out of band,
 * and the running process self-registers runtime facts on its first full
 * report (process-start hook, design §5.1).
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

  /** Latest module snapshot reported by the instance (`newbie status --json` modules[]). */
  async getModules(id: string) {
    const row = await this.getOrThrow(id);
    return row.modulesSnapshot ?? null;
  }

  /**
   * Set or clear the desired module set marked by host users (design §3, §4.1).
   * Pure data for read-time "target vs actual" display — NOT an execution
   * channel: the hub never dispatches it. Passing null clears the spec.
   */
  async setTargetSpec(id: string, spec: Record<string, unknown> | null, actor?: string) {
    await this.getOrThrow(id);
    // Prisma's Json? column type narrows null/objects at runtime; cast to any
    // to accept both null (clears) and arbitrary JSON objects (sets).
    await this.prisma.hubInstallation.update({
      where: { id },
      data: { targetSpec: spec as any },
    });
    await this.audit(id, "installation.target-spec", `host:${actor ?? "unknown"}`, { spec });
    return { id, targetSpec: spec };
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

  /** Soft revocation: reports are rejected (401), rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    await this.prisma.hubInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit(id, "installation.revoke", `host:${actor ?? "unknown"}`);
    return { id, revoked: true };
  }

  /** Token-only authentication for the report endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.hubInstallation.findUnique({
      where: { tokenHash: hashInstallationToken(token) },
    });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Self-registration of runtime facts on every report (design doc §4.2).
   * - kind="ping": only refreshes lastSeenAt.
   * - kind="full": writes firstSeenAt once (COALESCE) and refreshes all
   *   runtime fact columns, modulesSnapshot and registrySourceCommit.
   *
   * Routine reports (full and ping) are NOT audited.
   */
  async touchOnReport(
    id: string,
    facts: {
      kind: "full" | "ping";
      framework?: string;
      frameworkVersion?: string;
      appVersion?: string;
      env?: string;
      instanceId?: string;
      modules?: Array<Record<string, unknown>>;
      registrySourceCommit?: string;
    },
  ) {
    const now = new Date();
    if (facts.kind === "ping") {
      await this.prisma.$executeRaw`
        UPDATE "module/module-hub"."HubInstallation"
        SET "lastSeenAt" = ${now}, "updatedAt" = ${now}
        WHERE "id" = ${id}::uuid
      `;
      return;
    }
    // kind === "full": refresh all runtime fact columns + modulesSnapshot.
    const modulesJson = facts.modules ? JSON.stringify(facts.modules) : null;
    await this.prisma.$executeRaw`
      UPDATE "module/module-hub"."HubInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "framework" = ${facts.framework ?? null},
          "frameworkVersion" = ${facts.frameworkVersion ?? null},
          "appVersion" = ${facts.appVersion ?? null},
          "env" = ${facts.env ?? null},
          "instanceId" = ${facts.instanceId ?? null},
          "registrySourceCommit" = ${facts.registrySourceCommit ?? null},
          "modulesSnapshot" = ${modulesJson}::jsonb,
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
