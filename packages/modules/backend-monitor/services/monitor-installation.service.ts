import { Injectable, NotFoundException } from "@nestjs/common";
import { BackendMonitorInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import {
  InstallationCredentialStore,
  issueInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "@modules/security/installation/installation-credential";
import { InstallationTokenVerifier } from "@modules/security/installation/installation-token.verifier";

/** Probes flush roughly every 5s; three minutes without a batch marks stale. */
export const ONLINE_THRESHOLD_SECONDS = 180;

/**
 * Presence of the installations sharing one externalRef, normalized for the
 * platform-side per-facility dashboards. Several rows can share a ref (rotation
 * history, multiple instances):
 * - `enrolled` — at least one non-revoked installation exists.
 * - `online` — a non-revoked installation ingested within the online window.
 * - `lastSeenAt` — newest ingest time across the non-revoked installations
 *   (null until the first contact).
 * - `revokedOnly` — rows exist but every one is revoked.
 */
export interface InstallationPresence {
  enrolled: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  revokedOnly: boolean;
}

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "backend-monitor-installation";

/** Domain columns stored next to the credential (ADR-019). */
interface BackendMonitorInstallationDraft {
  label: string;
  externalRef: string | null;
  env: string | null;
  kind: string | null;
}

/**
 * Registry of backend-monitor deployment endpoints (module-hub design §9.2,
 * Phase 3 pilot). One token = one installation; the running process presents
 * it as X-Backend-Monitor-Token on /backend-monitor/ingest.
 *
 * Token generation, hashing, lifecycle and verification come from security
 * (ADR-019); this class only adapts the table and projects domain state.
 */
@Injectable()
export class MonitorInstallationService {
  private readonly credentials: InstallationCredentialStore<
    BackendMonitorInstallationDraft,
    BackendMonitorInstallation
  >;
  private readonly tokenVerifier: InstallationTokenVerifier<BackendMonitorInstallation>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.credentials = {
      create: (draft) => this.prisma.backendMonitorInstallation.create({ data: draft }),
      findByTokenHash: (tokenHash) => this.prisma.backendMonitorInstallation.findUnique({ where: { tokenHash } }),
      replaceTokenHash: async (id, tokenHash) => {
        await this.prisma.backendMonitorInstallation.update({ where: { id }, data: { tokenHash } });
      },
      setRevokedAt: async (id, revokedAt) => {
        await this.prisma.backendMonitorInstallation.update({ where: { id }, data: { revokedAt } });
      },
    };
    this.tokenVerifier = new InstallationTokenVerifier(this.credentials);
  }

  private withDerivedState(row: BackendMonitorInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string; env?: string; kind?: string }, actor?: string) {
    const { record, token } = await issueInstallationCredential(
      this.credentials,
      {
        label: input.label,
        externalRef: input.externalRef ?? null,
        env: input.env ?? null,
        kind: input.kind ?? null,
      },
      {
        recorder: this.auditLogService,
        resourceType: AUDIT_RESOURCE_TYPE,
        actorId: actor,
        detail: { label: input.label, externalRef: input.externalRef ?? null },
      },
    );
    return { ...this.withDerivedState(record), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.backendMonitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
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
    const rows = await this.prisma.backendMonitorInstallation.findMany({
      where: { externalRef: { in: externalRefs } },
      select: { externalRef: true, lastSeenAt: true, revokedAt: true },
    });
    const onlineThresholdMs = ONLINE_THRESHOLD_SECONDS * 1000;
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
        if (row.lastSeenAt != null && now - row.lastSeenAt.getTime() <= onlineThresholdMs) {
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
    const row = await this.prisma.backendMonitorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Monitor installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    return rotateInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
  }

  /** Soft revocation: ingest is rejected (401), rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return revokeInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
  }

  /** Token-only authentication for the ingest endpoint. */
  async resolveByToken(token: string) {
    return this.tokenVerifier.verify(token);
  }

  /**
   * Refresh liveness and self-reported facts on ingest. firstSeenAt is written
   * once (COALESCE); fact columns keep the latest non-null value. Called by
   * the resolver under a write throttle — ingest is high-volume.
   */
  async touchOnIngest(
    id: string,
    facts: {
      env?: string;
      appVersion?: string;
      instanceId?: string;
      kind?: string;
    },
  ) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/backend-monitor"."BackendMonitorInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "kind" = COALESCE(${facts.kind ?? null}, "kind"),
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
