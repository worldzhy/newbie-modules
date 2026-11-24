import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  InstallationPresence,
  isInstallationOnline,
} from "@modules/security/installation/installation-presence";
import { ModuleHubReleaseService } from "./release.service";

/** An installation reports every 60s; three missed intervals marks it offline (design §4.2). */
export const REPORT_INTERVAL_SECONDS = 60;

/** Three missed 60s intervals marks an installation offline (design §4.2). */
export const ONLINE_THRESHOLD_SECONDS = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/**
 * Module-hub audit events that are NOT part of the shared credential
 * lifecycle (ADR-019). Credential events (enroll/rotate/revoke) follow the
 * shared naming below; routine reports (ping/full) are NOT audited.
 */
export const ModuleHubAuditEvent = {
  INSTALLATION_TARGET_SPEC: "installation.target-spec",
} as const;

/** Resource type for installation-scoped audit rows. */
const AUDIT_RESOURCE_TYPE = "module-hub-installation";

/** Facts stored per installation (module/module-hub). */
interface ModuleHubFacts {
  repoUrl?: string | null;
  framework?: string | null;
  frameworkVersion?: string | null;
  appVersion?: string | null;
  env?: string | null;
  instanceId?: string | null;
  registrySourceCommit?: string | null;
  modulesSnapshot?: Prisma.JsonValue | null;
  targetSpec?: Prisma.JsonValue | null;
}

/** Projection returned by the host integration API. No credential material. */
export interface ModuleHubInstallationView {
  id: string;
  label: string;
  externalRef: string | null;
  repoUrl: string | null;
  framework: string | null;
  frameworkVersion: string | null;
  appVersion: string | null;
  env: string | null;
  instanceId: string | null;
  registrySourceCommit: string | null;
  modulesSnapshot: Prisma.JsonValue | null;
  targetSpec: Prisma.JsonValue | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  issuedAt: Date;
  revokedAt: Date | null;
  online: boolean;
}

// --- target-spec vs reported snapshot (read-time, design §3 targetSpec) ------

/** A single module row inside a `newbie status --json` modules[] snapshot. */
interface SnapshotModule {
  key: string;
  version?: string | null;
  sourceCommit?: string | null;
  /** Commit date of `sourceCommit`, stamped by the hub when a full report lands. */
  sourceCommittedAt?: string | null;
  installed?: boolean;
  hasSchema?: boolean;
  missingEnv?: string[];
  updateAvailable?: boolean;
  drift?: boolean;
  localPatches?: string[];
}

/** A module entry inside a stored targetSpec (newbie-modules.json modules[] shape). */
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
 * Pure read-time comparison between a stored targetSpec (newbie-modules.json shape)
 * and the last reported module snapshot (`newbie status --json` modules[]).
 *
 * The hub never dispatches the spec: developers/CI run `newbie modules update`, and
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

/** Latest catalogued release of one module, as needed by the upgrade check. */
interface LatestRelease {
  sourceCommit: string;
  committedAt: Date | null;
}

/**
 * Read-time "is the installed pin behind the registry" check (design §4.1).
 *
 * The runtime reporter deliberately omits `updateAvailable` (the CLI owns that
 * computation), so the hub derives it from its release catalog. A plain
 * "commit differs" comparison would flag every module whose pin points at a
 * later branch HEAD that merely happened to post-date the module's own last
 * change, therefore a module only counts as upgradeable when the latest
 * release's commit date is provably newer than the pin's commit date. Modules
 * with an unknown pin date stay quiet.
 */
export function annotateUpdateAvailability(snapshot: unknown, latestByKey: Map<string, LatestRelease>): unknown {
  if (!Array.isArray(snapshot)) return snapshot;
  return (snapshot as SnapshotModule[]).map((module) => {
    const latest = latestByKey.get(module.key);
    let updateAvailable = module.updateAvailable === true;
    if (!updateAvailable && latest && module.sourceCommit && latest.sourceCommit !== module.sourceCommit) {
      const pinnedAt = module.sourceCommittedAt ? new Date(module.sourceCommittedAt) : null;
      updateAvailable = Boolean(pinnedAt && latest.committedAt && latest.committedAt.getTime() > pinnedAt.getTime());
    }
    return { ...module, updateAvailable };
  });
}

/** How much of the upgrade hint the hub could actually compute. */
export interface HintCoverage {
  total: number;
  dated: number;
  catalogued: number;
}

/**
 * Coverage of the read-time upgrade hint, so a "no module is behind" answer can
 * be told apart from "the hub could not resolve pin dates / has no catalog".
 * Without this the hint degrades silently: an invalid registry token or an
 * empty catalog looks exactly like a fully up-to-date installation (R23-01).
 */
export function summarizeHintCoverage(snapshot: unknown, latestByKey: Map<string, LatestRelease>): HintCoverage {
  if (!Array.isArray(snapshot)) return { total: 0, dated: 0, catalogued: 0 };
  const modules = (snapshot as SnapshotModule[]).filter((module) => module && typeof module.key === "string");
  return {
    total: modules.length,
    dated: modules.filter((module) => Boolean(module.sourceCommittedAt)).length,
    catalogued: modules.filter((module) => latestByKey.has(module.key)).length,
  };
}

/**
 * Installation registry. Identity and credential live in the shared
 * `Installation` row; this service adds the module-hub fact projection. The
 * running process self-registers runtime facts on its first full report
 * (process-start hook, design §5.1).
 */
@Injectable()
export class ModuleHubInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: InstallationCredentialService,
    private readonly auditLogService: AuditLogService,
    private readonly releases: ModuleHubReleaseService,
  ) {}

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; repoUrl?: string; externalRef?: string; actor?: string }) {
    const { installation, token } = await this.credentials.create({
      kind: InstallationKind.MODULE_HUB,
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    const facts = await this.prisma.moduleHubAgentState.upsert({
      where: { installationId: installation.id },
      create: { installationId: installation.id, repoUrl: input.repoUrl ?? null },
      update: { repoUrl: input.repoUrl ?? undefined },
    });
    await this.recordAudit("module-hub.installation.created", installation.id, input.actor, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.toView(installation, facts), token };
  }

  async list(query: { externalRef?: string }) {
    const installations = await this.prisma.installation.findMany({
      where: {
        kind: InstallationKind.MODULE_HUB,
        ...(query.externalRef ? { externalRef: query.externalRef } : {}),
      },
      orderBy: { issuedAt: "desc" },
    });
    const facts = await this.factsByInstallationId(installations.map((row) => row.id));
    return installations.map((row) => this.toView(row, facts.get(row.id) ?? null));
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
    const rows = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.MODULE_HUB, externalRef: { in: externalRefs } },
      select: { externalRef: true, lastSeenAt: true, revokedAt: true },
    });
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
        // the newest report across the non-revoked installations sharing it.
        if (row.lastSeenAt && (!lastSeenAt || row.lastSeenAt > lastSeenAt)) {
          lastSeenAt = row.lastSeenAt;
        }
        if (isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)) {
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
    const installation = await this.prisma.installation.findFirst({
      where: { id, kind: InstallationKind.MODULE_HUB },
    });
    if (!installation) throw new NotFoundException(`Installation ${id} not found.`);
    return installation;
  }

  async get(id: string) {
    const installation = await this.getOrThrow(id);
    const facts = await this.prisma.moduleHubAgentState.findUnique({ where: { installationId: id } });
    return this.toView(installation, facts);
  }

  /**
   * Latest module snapshot reported by the instance (`newbie status --json`
   * modules[]) plus the read-time "target vs actual" comparison against the
   * stored targetSpec (design §4.1). Each entry is also stamped with the
   * derived `updateAvailable` flag against the registry release catalog.
   */
  async getModules(id: string) {
    const installation = await this.getOrThrow(id);
    const facts = await this.prisma.moduleHubAgentState.findUnique({ where: { installationId: id } });
    const targetSpec = (facts?.targetSpec as Record<string, unknown> | null) ?? null;
    const catalog = await this.releases.getCatalog();
    const latestByKey = new Map(catalog.map((release) => [release.moduleKey, release]));
    const actual = annotateUpdateAvailability(facts?.modulesSnapshot ?? null, latestByKey);
    return {
      actual,
      targetSpec,
      reportedAt: installation.lastSeenAt ?? null,
      comparison: compareTargetWithSnapshot(targetSpec, actual),
      hint: summarizeHintCoverage(facts?.modulesSnapshot ?? null, latestByKey),
    };
  }

  /**
   * Set or clear the desired module set marked by host users (design §3, §4.1).
   * Pure data for read-time "target vs actual" display — NOT an execution
   * channel: the hub never dispatches it. Passing null clears the spec.
   */
  async setTargetSpec(id: string, spec: Record<string, unknown> | null, actor?: string) {
    await this.getOrThrow(id);
    // Nullable Json columns distinguish "clear the value" (DbNull) from
    // "store an object" (InputJsonValue); plain null is not accepted.
    const targetSpec = spec === null ? Prisma.DbNull : (spec as Prisma.InputJsonValue);
    // The fact row is created lazily by the first report; a host may set the
    // target before that, so upsert instead of update.
    await this.prisma.moduleHubAgentState.upsert({
      where: { installationId: id },
      create: { installationId: id, targetSpec },
      update: { targetSpec },
    });
    await this.auditLogService.record(ModuleHubAuditEvent.INSTALLATION_TARGET_SPEC, {
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId: id,
      actorType: "host",
      actorId: actor ?? null,
      detail: { spec },
    });
    return { id, targetSpec: spec };
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const rotated = await this.credentials.rotate(id);
    await this.recordAudit("module-hub.installation.token_rotated", id, actor);
    return rotated;
  }

  /** Soft revocation: reports are rejected (401), rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    const revokedAt = new Date();
    await this.credentials.setRevokedAt(id, revokedAt);
    await this.recordAudit("module-hub.installation.revoked", id, actor);
    return { id, revokedAt };
  }

  /**
   * Stamp every snapshot entry with the commit date of its pin. The read-time
   * upgrade check needs it to distinguish "a newer release exists" from "the
   * pin already contains the module's latest change but sits on a later HEAD".
   * Best-effort: an unresolved commit leaves the entry untouched and only
   * disables the upgrade hint for that module.
   */
  private async withPinCommitDates(modules: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
    const pins = [
      ...new Set(
        modules
          .map((module) => (typeof module.sourceCommit === "string" ? module.sourceCommit : null))
          .filter((pin): pin is string => Boolean(pin)),
      ),
    ];
    if (pins.length === 0) return modules;

    const dates = new Map<string, Date | null>();
    await Promise.all(pins.map(async (pin) => dates.set(pin, await this.releases.resolveCommitDate(pin))));

    return modules.map((module) => {
      const pin = typeof module.sourceCommit === "string" ? module.sourceCommit : null;
      const committedAt = pin ? dates.get(pin) : null;
      return committedAt ? { ...module, sourceCommittedAt: committedAt.toISOString() } : module;
    });
  }

  /**
   * Self-registration of runtime facts on every report (design doc §4.2).
   * - kind="ping": only refreshes the shared row's lastSeenAt.
   * - kind="full": writes firstSeenAt once (COALESCE) and refreshes the fact
   *   row (runtime columns, modulesSnapshot and registrySourceCommit).
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
        UPDATE "module/security"."Installation"
        SET "lastSeenAt" = ${now}, "updatedAt" = ${now}
        WHERE "id" = ${id}
      `;
      return;
    }
    // kind === "full": advance liveness, then refresh the fact row.
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${id}
    `;
    const modules = facts.modules ? await this.withPinCommitDates(facts.modules) : undefined;
    await this.prisma.moduleHubAgentState.upsert({
      where: { installationId: id },
      create: {
        installationId: id,
        framework: facts.framework ?? null,
        frameworkVersion: facts.frameworkVersion ?? null,
        appVersion: facts.appVersion ?? null,
        env: facts.env ?? null,
        instanceId: facts.instanceId ?? null,
        registrySourceCommit: facts.registrySourceCommit ?? null,
        modulesSnapshot: modules ? (modules as Prisma.InputJsonValue) : Prisma.DbNull,
      },
      update: {
        framework: facts.framework ?? undefined,
        frameworkVersion: facts.frameworkVersion ?? undefined,
        appVersion: facts.appVersion ?? undefined,
        env: facts.env ?? undefined,
        instanceId: facts.instanceId ?? undefined,
        registrySourceCommit: facts.registrySourceCommit ?? undefined,
        modulesSnapshot: modules ? (modules as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async factsByInstallationId(installationIds: string[]) {
    if (installationIds.length === 0) return new Map<string, ModuleHubFacts>();
    const rows = await this.prisma.moduleHubAgentState.findMany({
      where: { installationId: { in: installationIds } },
    });
    return new Map(rows.map((row) => [row.installationId, row]));
  }

  private toView(installation: Installation, facts: ModuleHubFacts | null): ModuleHubInstallationView {
    const online =
      !installation.revokedAt &&
      installation.lastSeenAt != null &&
      Date.now() - installation.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
    return {
      id: installation.id,
      label: installation.label,
      externalRef: installation.externalRef,
      repoUrl: facts?.repoUrl ?? null,
      framework: facts?.framework ?? null,
      frameworkVersion: facts?.frameworkVersion ?? null,
      appVersion: facts?.appVersion ?? null,
      env: facts?.env ?? null,
      instanceId: facts?.instanceId ?? null,
      registrySourceCommit: facts?.registrySourceCommit ?? null,
      modulesSnapshot: facts?.modulesSnapshot ?? null,
      targetSpec: facts?.targetSpec ?? null,
      firstSeenAt: installation.firstSeenAt,
      lastSeenAt: installation.lastSeenAt,
      issuedAt: installation.issuedAt,
      revokedAt: installation.revokedAt,
      online,
    };
  }

  private async recordAudit(
    action: string,
    resourceId: string,
    actor?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record({
      action,
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId,
      actorId: actor ?? null,
      actorType: actor ? "user" : "system",
      detail,
    });
  }
}
