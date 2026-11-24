import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  InstallationPresence,
  isInstallationOnline,
} from "@modules/security/installation/installation-presence";

/** Probes flush roughly every minute; three missed batches marks stale. */
export const REPORT_INTERVAL_SECONDS = 60;

/** Three minutes without a batch marks an installation stale. */
export const ONLINE_THRESHOLD_SECONDS = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "backend-monitor-installation";

/** Facts stored per installation (module/backend-monitor). */
interface BackendMonitorFacts {
  env?: string | null;
  appVersion?: string | null;
  instanceId?: string | null;
  runtime?: string | null;
}

/** Projection returned by the host integration API. No credential material. */
export interface MonitorInstallationView {
  id: string;
  label: string;
  externalRef: string | null;
  env: string | null;
  appVersion: string | null;
  instanceId: string | null;
  /** Reporter family, formerly the fact column `kind` (now `runtime`). */
  kind: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  issuedAt: Date;
  revokedAt: Date | null;
  online: boolean;
}

/**
 * Registry of backend-monitor deployment endpoints (module-hub design §9.2,
 * Phase 3 pilot). Identity and credential live in the shared `Installation`
 * row; this service adds the ingest fact projection and liveness queries the
 * host consumes. The running process presents its token as
 * X-Backend-Monitor-Token on /backend-monitor/ingest.
 */
@Injectable()
export class MonitorInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: InstallationCredentialService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string; env?: string; kind?: string }, actor?: string) {
    const { installation, token } = await this.credentials.create({
      kind: InstallationKind.BACKEND_MONITOR,
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    const facts = await this.prisma.backendMonitorAgentState.upsert({
      where: { installationId: installation.id },
      create: {
        installationId: installation.id,
        env: input.env ?? null,
        runtime: input.kind ?? null,
      },
      update: {
        env: input.env ?? undefined,
        runtime: input.kind ?? undefined,
      },
    });
    await this.recordAudit("backend-monitor.installation.created", installation.id, actor, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.toView(installation, facts), token };
  }

  async list(query: { externalRef?: string }) {
    const installations = await this.prisma.installation.findMany({
      where: {
        kind: InstallationKind.BACKEND_MONITOR,
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
      where: { kind: InstallationKind.BACKEND_MONITOR, externalRef: { in: externalRefs } },
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
        // the newest ingest across the non-revoked installations sharing it.
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
      where: { id, kind: InstallationKind.BACKEND_MONITOR },
    });
    if (!installation) throw new NotFoundException(`Monitor installation ${id} not found.`);
    return installation;
  }

  async get(id: string) {
    const installation = await this.getOrThrow(id);
    const facts = await this.prisma.backendMonitorAgentState.findUnique({ where: { installationId: id } });
    return this.toView(installation, facts);
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const rotated = await this.credentials.rotate(id);
    await this.recordAudit("backend-monitor.installation.token_rotated", id, actor);
    return rotated;
  }

  /** Soft revocation: ingest is rejected (401), rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    const revokedAt = new Date();
    await this.credentials.setRevokedAt(id, revokedAt);
    await this.recordAudit("backend-monitor.installation.revoked", id, actor);
    return { id, revokedAt };
  }

  /**
   * Refresh liveness and self-reported facts on ingest. firstSeenAt is written
   * once (COALESCE); the fact row keeps the latest non-null value per column.
   * Called by the resolver under a write throttle — ingest is high-volume.
   */
  async touchOnIngest(
    id: string,
    facts: {
      env?: string;
      appVersion?: string;
      instanceId?: string;
      runtime?: string;
    },
  ) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${id}
    `;
    await this.prisma.backendMonitorAgentState.upsert({
      where: { installationId: id },
      create: {
        installationId: id,
        env: facts.env ?? null,
        appVersion: facts.appVersion ?? null,
        instanceId: facts.instanceId ?? null,
        runtime: facts.runtime ?? null,
      },
      update: {
        env: facts.env ?? undefined,
        appVersion: facts.appVersion ?? undefined,
        instanceId: facts.instanceId ?? undefined,
        runtime: facts.runtime ?? undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async factsByInstallationId(installationIds: string[]) {
    if (installationIds.length === 0) return new Map<string, BackendMonitorFacts>();
    const rows = await this.prisma.backendMonitorAgentState.findMany({
      where: { installationId: { in: installationIds } },
    });
    return new Map(rows.map((row) => [row.installationId, row]));
  }

  private toView(installation: Installation, facts: BackendMonitorFacts | null): MonitorInstallationView {
    const online =
      !installation.revokedAt &&
      installation.lastSeenAt != null &&
      Date.now() - installation.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
    return {
      id: installation.id,
      label: installation.label,
      externalRef: installation.externalRef,
      env: facts?.env ?? null,
      appVersion: facts?.appVersion ?? null,
      instanceId: facts?.instanceId ?? null,
      kind: facts?.runtime ?? null,
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
