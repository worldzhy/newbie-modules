import { createHash, randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";

/** An installation reports every 60s; three missed intervals marks it offline (design §4.2). */
export const ONLINE_THRESHOLD_SECONDS = 180;

/**
 * Module-hub audit events. The audit module's event set is open (domain
 * modules define their own `domain.action` strings); these are the ones the
 * hub emits. Routine reports (ping/full) are NOT audited.
 */
export const ModuleHubAuditEvent = {
  INSTALLATION_ENROLL: "installation.enroll",
  INSTALLATION_TARGET_SPEC: "installation.target-spec",
  INSTALLATION_ROTATE: "installation.rotate",
  INSTALLATION_REVOKE: "installation.revoke",
} as const;

/** Resource type for installation-scoped audit rows. */
const INSTALLATION_RESOURCE_TYPE = "module-hub-installation";

export function hashInstallationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- target-spec vs reported snapshot (read-time, design §3 targetSpec) ------

/** A single module row inside a `newbie status --json` modules[] snapshot. */
interface SnapshotModule {
  key: string;
  version?: string | null;
  sourceCommit?: string | null;
  installed?: boolean;
  hasSchema?: boolean;
  missingEnv?: string[];
  updateAvailable?: boolean;
  drift?: boolean;
  localPatches?: string[];
}

/** A module entry inside a stored targetSpec (modules.json modules[] shape). */
interface TargetModule {
  key: string;
  version?: string | null;
  sourceCommit?: string | null;
}

export type ModuleConvergenceStatus = "converged" | "pending" | "missing" | "untracked";

export interface ModuleConvergenceEntry {
  key: string;
  status: ModuleConvergenceStatus;
  target: Pick<TargetModule, "version" | "sourceCommit"> | null;
  actual: SnapshotModule | null;
}

export interface TargetActualComparison {
  // true = every target module reported at the pinned commit; false = some
  // target module missing or at a different commit; null = no targetSpec set
  // (nothing to converge against).
  converged: boolean | null;
  entries: ModuleConvergenceEntry[];
}

/**
 * Pure read-time comparison between a stored targetSpec (modules.json shape)
 * and the last reported module snapshot (`newbie status --json` modules[]).
 *
 * The hub never dispatches the spec: developers/CI run `newbie update`, and
 * the next process-start "full" report proves convergence with its snapshot.
 */
export function compareTargetWithSnapshot(
  targetSpec: Record<string, unknown> | null,
  snapshot: unknown,
): TargetActualComparison {
  const targetModules = Array.isArray(targetSpec?.modules)
    ? ((targetSpec.modules as TargetModule[]).filter((m) => m && typeof m.key === "string") ?? [])
    : [];
  const actualModules = Array.isArray(snapshot)
    ? (snapshot as SnapshotModule[]).filter((m) => m && typeof m.key === "string")
    : [];

  if (targetModules.length === 0) {
    return { converged: null, entries: [] };
  }

  const actualByKey = new Map(actualModules.map((m) => [m.key, m]));
  const targetKeys = new Set(targetModules.map((m) => m.key));
  const entries: ModuleConvergenceEntry[] = [];

  for (const target of targetModules) {
    const actual = actualByKey.get(target.key) ?? null;
    let status: ModuleConvergenceStatus;
    if (!actual || actual.installed === false) {
      status = "missing";
    } else if (
      // A null pin means "whatever is installed is fine"; only explicit pins
      // participate in the commit comparison.
      target.sourceCommit != null &&
      actual.sourceCommit !== target.sourceCommit
    ) {
      status = "pending";
    } else {
      status = "converged";
    }
    entries.push({
      key: target.key,
      status,
      target: { version: target.version ?? null, sourceCommit: target.sourceCommit ?? null },
      actual,
    });
  }

  // Reported modules absent from the target are informational only — they do
  // not block convergence (the spec is a desired subset, not a deny list).
  for (const actual of actualModules) {
    if (!targetKeys.has(actual.key)) {
      entries.push({
        key: actual.key,
        status: "untracked",
        target: null,
        actual,
      });
    }
  }

  const converged = entries.filter((e) => e.status !== "untracked").every((e) => e.status === "converged");

  return { converged, entries };
}

/**
 * Installation registry. One token = one installation instance; the host
 * pre-creates rows and distributes the plaintext report token out of band,
 * and the running process self-registers runtime facts on its first full
 * report (process-start hook, design §5.1).
 */
@Injectable()
export class ModuleHubInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

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
    const row = await this.prisma.moduleHubInstallation.create({
      data: {
        label: input.label,
        repoUrl: input.repoUrl ?? null,
        externalRef: input.externalRef ?? null,
        tokenHash: hashInstallationToken(token),
      },
    });
    await this.auditLogService.record(ModuleHubAuditEvent.INSTALLATION_ENROLL, {
      resourceType: INSTALLATION_RESOURCE_TYPE,
      resourceId: row.id,
      actorType: "host",
      actorId: input.actor ?? "unknown",
      detail: { label: input.label, externalRef: input.externalRef ?? null },
    });
    return { ...this.withDerivedState(row), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.moduleHubInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.moduleHubInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /**
   * Latest module snapshot reported by the instance (`newbie status --json`
   * modules[]) plus the read-time "target vs actual" comparison against the
   * stored targetSpec (design §4.1).
   */
  async getModules(id: string) {
    const row = await this.getOrThrow(id);
    const targetSpec = (row.targetSpec as Record<string, unknown> | null) ?? null;
    return {
      actual: (row.modulesSnapshot as unknown[] | null) ?? null,
      targetSpec,
      reportedAt: row.lastSeenAt ?? null,
      comparison: compareTargetWithSnapshot(targetSpec, row.modulesSnapshot),
    };
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
    await this.prisma.moduleHubInstallation.update({
      where: { id },
      data: { targetSpec: spec as any },
    });
    await this.auditLogService.record(ModuleHubAuditEvent.INSTALLATION_TARGET_SPEC, {
      resourceType: INSTALLATION_RESOURCE_TYPE,
      resourceId: id,
      actorType: "host",
      actorId: actor ?? "unknown",
      detail: { spec },
    });
    return { id, targetSpec: spec };
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const token = randomUUID();
    await this.prisma.moduleHubInstallation.update({
      where: { id },
      data: { tokenHash: hashInstallationToken(token) },
    });
    await this.auditLogService.record(ModuleHubAuditEvent.INSTALLATION_ROTATE, {
      resourceType: INSTALLATION_RESOURCE_TYPE,
      resourceId: id,
      actorType: "host",
      actorId: actor ?? "unknown",
    });
    return { id, token };
  }

  /** Soft revocation: reports are rejected (401), rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    await this.prisma.moduleHubInstallation.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.auditLogService.record(ModuleHubAuditEvent.INSTALLATION_REVOKE, {
      resourceType: INSTALLATION_RESOURCE_TYPE,
      resourceId: id,
      actorType: "host",
      actorId: actor ?? "unknown",
    });
    return { id, revoked: true };
  }

  /** Token-only authentication for the report endpoint. */
  async resolveByToken(token: string) {
    const row = await this.prisma.moduleHubInstallation.findUnique({
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
        UPDATE "module/module-hub"."ModuleHubInstallation"
        SET "lastSeenAt" = ${now}, "updatedAt" = ${now}
        WHERE "id" = ${id}::uuid
      `;
      return;
    }
    // kind === "full": refresh all runtime fact columns + modulesSnapshot.
    const modulesJson = facts.modules ? JSON.stringify(facts.modules) : null;
    await this.prisma.$executeRaw`
      UPDATE "module/module-hub"."ModuleHubInstallation"
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
}
