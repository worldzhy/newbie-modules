import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import { InstallationPresence, isInstallationOnline } from "@modules/security/installation/installation-presence";
import { LivenessState, worseLivenessState } from "@modules/security/installation/liveness-state";

/** Requested interval between client snapshots; echoed back in the response. */
export const SNAPSHOT_INTERVAL_SECONDS = 30;

/** Three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = SNAPSHOT_INTERVAL_SECONDS * 3;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "health-installation";

/** Facts stored per installation (module/health). */
interface HealthFacts {
  appVersion?: string | null;
  env?: string | null;
  instanceId?: string | null;
  lastSnapshotStatus?: string | null;
  lastSnapshotInfo?: Prisma.JsonValue | null;
  lastSnapshotAt?: Date | null;
}

/** One failing dependency indicator from the latest snapshot. */
export interface HealthDownIndicator {
  name: string;
  message: string | null;
}

/**
 * Normalized liveness snapshot of one externalRef, ready for host-side
 * aggregation. `downIndicators` lists the dependencies reported as "down"
 * in the latest snapshot (empty for every state except "degraded").
 */
export interface HealthLivenessSnapshot {
  state: LivenessState;
  lastSnapshotAt: Date | null;
  downIndicators: HealthDownIndicator[];
}

/** Projection returned by the host integration API. No credential material. */
export interface HealthInstallationView {
  id: string;
  label: string;
  externalRef: string | null;
  appVersion: string | null;
  env: string | null;
  instanceId: string | null;
  lastSnapshotStatus: string | null;
  lastSnapshotInfo: Prisma.JsonValue | null;
  lastSnapshotAt: Date | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  issuedAt: Date;
  revokedAt: Date | null;
  state: LivenessState;
}

/**
 * Installation registry for the health module. Identity and credential live
 * in the shared `Installation` row; this service adds the latest-snapshot
 * fact projection and the richer state (unknown / healthy / degraded /
 * offline) the host consumes.
 *
 * The host pre-creates rows and distributes the plaintext token out of band,
 * and the running process posts a dependency health snapshot periodically.
 */
@Injectable()
export class HealthInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: InstallationCredentialService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Installation lifecycle (host integration API)
  // -------------------------------------------------------------------------

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string }, actor?: string) {
    const { installation, token } = await this.credentials.create({
      kind: InstallationKind.HEALTH,
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    await this.recordAudit("health.installation.created", installation.id, actor, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.toView(installation, null), token };
  }

  async list(query: { externalRef?: string }) {
    const installations = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.HEALTH, ...(query.externalRef ? { externalRef: query.externalRef } : {}) },
      orderBy: { issuedAt: "desc" },
    });
    const facts = await this.factsByInstallationId(installations.map((row) => row.id));
    return installations.map((row) => this.toView(row, facts.get(row.id) ?? null));
  }

  async getOrThrow(id: string) {
    const installation = await this.prisma.installation.findFirst({
      where: { id, kind: InstallationKind.HEALTH },
    });
    if (!installation) throw new NotFoundException(`Installation ${id} not found.`);
    return installation;
  }

  async get(id: string) {
    const installation = await this.getOrThrow(id);
    const facts = await this.prisma.healthAgentState.findUnique({ where: { installationId: id } });
    return this.toView(installation, facts);
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const rotated = await this.credentials.rotate(id);
    await this.recordAudit("health.installation.token_rotated", id, actor);
    return rotated;
  }

  /** Soft revocation: snapshots are rejected (401), rows retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    const revokedAt = new Date();
    await this.credentials.setRevokedAt(id, revokedAt);
    await this.recordAudit("health.installation.revoked", id, actor);
    return { id, revokedAt };
  }

  // -------------------------------------------------------------------------
  // Health state queries
  // -------------------------------------------------------------------------

  /**
   * Batch liveness lookup for platform-side list views: externalRef -> snapshot.
   * One installation query plus one fact query for the whole set; an
   * externalRef with no installation (or none at all) is simply absent from
   * the map. When multiple installations share an externalRef, the worst
   * state wins; ties keep the newest snapshot.
   */
  async getLivenessByExternalRefs(externalRefs: string[]): Promise<Map<string, HealthLivenessSnapshot>> {
    if (externalRefs.length === 0) return new Map();
    const installations = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.HEALTH, externalRef: { in: externalRefs }, revokedAt: null },
      select: { id: true, externalRef: true },
    });
    const facts = await this.factsByInstallationId(installations.map((row) => row.id));
    const snapshots = new Map<string, HealthLivenessSnapshot>();
    for (const installation of installations) {
      if (!installation.externalRef) continue;
      const state = facts.get(installation.id);
      const lastSnapshotAt = state?.lastSnapshotAt ?? null;
      const lastSnapshotStatus = state?.lastSnapshotStatus ?? null;
      const liveness = this.deriveState(lastSnapshotAt, lastSnapshotStatus);
      const candidate: HealthLivenessSnapshot = {
        state: liveness,
        lastSnapshotAt,
        // Indicator detail is only meaningful while the process is reporting;
        // an offline process's stale info must not masquerade as live faults.
        downIndicators:
          liveness === LivenessState.DEGRADED ? this.extractDownIndicators(state?.lastSnapshotInfo ?? null) : [],
      };
      const prev = snapshots.get(installation.externalRef);
      if (!prev) {
        snapshots.set(installation.externalRef, candidate);
        continue;
      }
      // Worst state wins across installations; on a tie the newer snapshot
      // carries the more current indicators.
      const worse = worseLivenessState(prev.state, liveness);
      if (worse === liveness && worse !== prev.state) {
        snapshots.set(installation.externalRef, candidate);
      } else if (
        worse === liveness &&
        candidate.lastSnapshotAt &&
        (!prev.lastSnapshotAt || candidate.lastSnapshotAt > prev.lastSnapshotAt)
      ) {
        snapshots.set(installation.externalRef, candidate);
      }
    }
    return snapshots;
  }

  /**
   * Batch presence lookup for platform-side per-facility views:
   * externalRef -> InstallationPresence. One query for the whole set; an
   * externalRef with no installation row at all is absent from the map.
   * Revoked rows are included so the caller can distinguish NOT_ENABLED
   * (no rows) from DISABLED (only revoked rows). `online` mirrors the
   * reporting convention used by the settings UI: healthy/degraded counts
   * as reporting, unknown/offline does not.
   */
  async getPresenceByExternalRefs(externalRefs: string[]): Promise<Map<string, InstallationPresence>> {
    if (externalRefs.length === 0) return new Map();
    const rows = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.HEALTH, externalRef: { in: externalRefs } },
      select: { externalRef: true, lastSeenAt: true, firstSeenAt: true, revokedAt: true },
    });
    const now = Date.now();
    const presenceByRef = new Map<string, InstallationPresence>();
    for (const externalRef of externalRefs) {
      const scoped = rows.filter((row) => row.externalRef === externalRef);
      if (scoped.length === 0) continue;
      const active = scoped.filter((row) => !row.revokedAt);
      let lastSeenAt: Date | null = null;
      let firstSeenAt: Date | null = null;
      let online = false;
      for (const row of active) {
        // Newest report across the non-revoked installations sharing it.
        if (row.lastSeenAt && (!lastSeenAt || row.lastSeenAt > lastSeenAt)) {
          lastSeenAt = row.lastSeenAt;
        }
        if (row.firstSeenAt && (!firstSeenAt || row.firstSeenAt < firstSeenAt)) {
          firstSeenAt = row.firstSeenAt;
        }
        if (isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)) {
          online = true;
        }
      }
      presenceByRef.set(externalRef, {
        enrolled: active.length > 0,
        online,
        lastSeenAt,
        firstSeenAt,
        revokedOnly: active.length === 0,
      });
    }
    return presenceByRef;
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
      state: LivenessState;
      lastSnapshotAt: Date | null;
      lastSnapshotStatus: string | null;
      lastSnapshotInfo: unknown;
    }>
  > {
    const cutoff = new Date(Date.now() - ONLINE_THRESHOLD_MILLISECONDS);
    const installations = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.HEALTH, revokedAt: null },
      select: { id: true, label: true },
    });
    const facts = await this.factsByInstallationId(installations.map((row) => row.id));
    return installations
      .map((installation) => {
        const state = facts.get(installation.id);
        const lastSnapshotAt = state?.lastSnapshotAt ?? null;
        const lastSnapshotStatus = state?.lastSnapshotStatus ?? null;
        return {
          id: installation.id,
          label: installation.label,
          env: state?.env ?? null,
          instanceId: state?.instanceId ?? null,
          appVersion: state?.appVersion ?? null,
          state: this.deriveState(lastSnapshotAt, lastSnapshotStatus),
          lastSnapshotAt,
          lastSnapshotStatus,
          lastSnapshotInfo: state?.lastSnapshotInfo ?? null,
        };
      })
      .filter(
        (row) => row.lastSnapshotStatus === "error" || row.lastSnapshotAt === null || row.lastSnapshotAt < cutoff,
      );
  }

  // -------------------------------------------------------------------------
  // Snapshot ingest
  // -------------------------------------------------------------------------

  /**
   * Advance liveness and store the latest snapshot for an already-authenticated
   * installation. Authentication happens upstream in InstallationAuthGuard
   * (ADR-016). firstSeenAt is written exactly once, lastSeenAt always advances,
   * and the snapshot columns are replaced on every report.
   */
  async recordSnapshot(
    installationId: string,
    facts: {
      appVersion?: string;
      env?: string;
      instanceId?: string;
      status: string;
      info: Record<string, { status: string; message?: string }>;
    },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${installationId}
    `;
    await this.prisma.healthAgentState.upsert({
      where: { installationId },
      create: {
        installationId,
        appVersion: facts.appVersion ?? null,
        env: facts.env ?? null,
        instanceId: facts.instanceId ?? null,
        lastSnapshotStatus: facts.status,
        lastSnapshotInfo: facts.info as unknown as Prisma.InputJsonValue,
        lastSnapshotAt: now,
      },
      update: {
        appVersion: facts.appVersion ?? undefined,
        env: facts.env ?? undefined,
        instanceId: facts.instanceId ?? undefined,
        lastSnapshotStatus: facts.status,
        lastSnapshotInfo: facts.info as unknown as Prisma.InputJsonValue,
        lastSnapshotAt: now,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private deriveState(lastSnapshotAt: Date | null, lastSnapshotStatus: string | null): LivenessState {
    if (!lastSnapshotAt) return LivenessState.UNKNOWN;
    if (!isInstallationOnline(lastSnapshotAt, ONLINE_THRESHOLD_SECONDS)) return LivenessState.OFFLINE;
    return lastSnapshotStatus === "ok" ? LivenessState.HEALTHY : LivenessState.DEGRADED;
  }

  /**
   * Pull the failing indicators out of a snapshot info JSON blob.
   * Malformed/non-object payloads (defensive: the column accepts arbitrary
   * JSON) yield an empty list rather than a runtime error.
   */
  private extractDownIndicators(info: Prisma.JsonValue | null): HealthDownIndicator[] {
    if (!info || typeof info !== "object" || Array.isArray(info)) return [];
    const result: HealthDownIndicator[] = [];
    for (const [name, entry] of Object.entries(info as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const indicator = entry as { status?: unknown; message?: unknown };
      if (indicator.status !== "down") continue;
      result.push({
        name,
        message: typeof indicator.message === "string" ? indicator.message : null,
      });
    }
    return result;
  }

  private async factsByInstallationId(installationIds: string[]) {
    if (installationIds.length === 0) return new Map<string, HealthFacts>();
    const rows = await this.prisma.healthAgentState.findMany({
      where: { installationId: { in: installationIds } },
    });
    return new Map(rows.map((row) => [row.installationId, row]));
  }

  private toView(installation: Installation, facts: HealthFacts | null): HealthInstallationView {
    const lastSnapshotAt = facts?.lastSnapshotAt ?? null;
    const lastSnapshotStatus = facts?.lastSnapshotStatus ?? null;
    return {
      id: installation.id,
      label: installation.label,
      externalRef: installation.externalRef,
      appVersion: facts?.appVersion ?? null,
      env: facts?.env ?? null,
      instanceId: facts?.instanceId ?? null,
      lastSnapshotStatus,
      lastSnapshotInfo: facts?.lastSnapshotInfo ?? null,
      lastSnapshotAt,
      firstSeenAt: installation.firstSeenAt,
      lastSeenAt: installation.lastSeenAt,
      issuedAt: installation.issuedAt,
      revokedAt: installation.revokedAt,
      state: this.deriveState(lastSnapshotAt, lastSnapshotStatus),
    };
  }

  private async recordAudit(
    action: string,
    resourceId: string,
    actor?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogService.record(action, {
      resourceType: AUDIT_RESOURCE_TYPE,
      resourceId,
      actorId: actor ?? null,
      actorType: actor ? "user" : "system",
      detail,
    });
  }
}
