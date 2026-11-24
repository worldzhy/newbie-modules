import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import { InstallationPresence, isInstallationOnline } from "@modules/security/installation/installation-presence";

/** Requested interval between client pings; echoed back in the ping response. */
export const PING_INTERVAL_SECONDS = 30;

/** Three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = PING_INTERVAL_SECONDS * 3;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "heartbeat-installation";

/** Runtime facts stored per installation (module/heartbeat). */
interface HeartbeatFacts {
  appVersion?: string;
  env?: string;
  instanceId?: string;
}

/** Projection returned by the host integration API. No credential material. */
export interface HeartbeatInstallationView {
  id: string;
  label: string;
  externalRef: string | null;
  appVersion: string | null;
  env: string | null;
  instanceId: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  issuedAt: Date;
  revokedAt: Date | null;
  online: boolean;
}

/**
 * Installation registry for the heartbeat module. Identity and credential
 * live in the shared `Installation` row; this service adds the heartbeat
 * fact projection and the liveness queries the host consumes.
 */
@Injectable()
export class HeartbeatInstallationService {
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
      kind: InstallationKind.HEARTBEAT,
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    await this.recordAudit("heartbeat.installation.created", installation.id, actor, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.toView(installation, null), token };
  }

  async list(query: { externalRef?: string }) {
    const installations = await this.prisma.installation.findMany({
      where: { kind: InstallationKind.HEARTBEAT, ...(query.externalRef ? { externalRef: query.externalRef } : {}) },
      orderBy: { issuedAt: "desc" },
    });
    const facts = await this.factsByInstallationId(installations.map((row) => row.id));
    return installations.map((row) => this.toView(row, facts.get(row.id) ?? null));
  }

  async getOrThrow(id: string) {
    const installation = await this.prisma.installation.findFirst({
      where: { id, kind: InstallationKind.HEARTBEAT },
    });
    if (!installation) throw new NotFoundException(`Installation ${id} not found.`);
    return installation;
  }

  async get(id: string) {
    const installation = await this.getOrThrow(id);
    const facts = await this.prisma.heartbeatAgentState.findUnique({ where: { installationId: id } });
    return this.toView(installation, facts);
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const rotated = await this.credentials.rotate(id);
    await this.recordAudit("heartbeat.installation.token_rotated", id, actor);
    return rotated;
  }

  /** Soft revocation: pings are rejected (401), rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    await this.credentials.setRevokedAt(id, new Date());
    await this.recordAudit("heartbeat.installation.revoked", id, actor);
    return { id, revokedAt: new Date() };
  }

  // -------------------------------------------------------------------------
  // Liveness queries
  // -------------------------------------------------------------------------

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
      where: { kind: InstallationKind.HEARTBEAT, externalRef: { in: externalRefs } },
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
        if (row.lastSeenAt && (!lastSeenAt || row.lastSeenAt > lastSeenAt)) lastSeenAt = row.lastSeenAt;
        if (row.lastSeenAt != null && isInstallationOnline(row.lastSeenAt, ONLINE_THRESHOLD_SECONDS, now)) {
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

  /**
   * Return installations that have stopped pinging: not revoked, have been
   * seen at least once, and whose lastSeenAt is older than the online
   * threshold. Runtime facts are joined so callers can render an alert
   * without a second query.
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
    const rows = await this.prisma.installation.findMany({
      where: {
        kind: InstallationKind.HEARTBEAT,
        revokedAt: null,
        lastSeenAt: { not: null, lt: cutoff },
      },
      select: { id: true, label: true, lastSeenAt: true },
    });
    const offline = rows.filter((row): row is typeof row & { lastSeenAt: Date } => row.lastSeenAt !== null);
    const facts = await this.factsByInstallationId(offline.map((row) => row.id));
    return offline.map((row) => {
      const state = facts.get(row.id);
      return {
        id: row.id,
        label: row.label,
        env: state?.env ?? null,
        instanceId: state?.instanceId ?? null,
        appVersion: state?.appVersion ?? null,
        lastSeenAt: row.lastSeenAt,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Ping ingest
  // -------------------------------------------------------------------------

  /**
   * Advance liveness for an already-authenticated installation. Authentication
   * happens upstream in InstallationAuthGuard (ADR-016). firstSeenAt is written
   * exactly once, lastSeenAt always advances, runtime facts refresh when sent.
   */
  async recordPing(installationId: string, facts: HeartbeatFacts): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${installationId}
    `;
    await this.prisma.heartbeatAgentState.upsert({
      where: { installationId },
      create: {
        installationId,
        appVersion: facts.appVersion ?? null,
        env: facts.env ?? null,
        instanceId: facts.instanceId ?? null,
      },
      update: {
        appVersion: facts.appVersion ?? undefined,
        env: facts.env ?? undefined,
        instanceId: facts.instanceId ?? undefined,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async factsByInstallationId(installationIds: string[]) {
    if (installationIds.length === 0) return new Map<string, HeartbeatFacts>();
    const rows = await this.prisma.heartbeatAgentState.findMany({
      where: { installationId: { in: installationIds } },
    });
    return new Map(rows.map((row) => [row.installationId, row]));
  }

  private toView(installation: Installation, facts: HeartbeatFacts | null): HeartbeatInstallationView {
    const online =
      !installation.revokedAt &&
      installation.lastSeenAt != null &&
      Date.now() - installation.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
    return {
      id: installation.id,
      label: installation.label,
      externalRef: installation.externalRef,
      appVersion: facts?.appVersion ?? null,
      env: facts?.env ?? null,
      instanceId: facts?.instanceId ?? null,
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
