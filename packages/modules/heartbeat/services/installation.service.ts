import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { HeartbeatInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import {
  InstallationCredentialStore,
  issueInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "@modules/security/installation/installation-credential";
import { InstallationTokenVerifier } from "@modules/security/installation/installation-token.verifier";
import { InstallationResolver } from "@modules/security/ports/installation.resolver";

/** Requested interval between client pings; echoed back in the ping response. */
export const PING_INTERVAL_SECONDS = 30;

/** Three missed intervals marks an installation offline. */
export const ONLINE_THRESHOLD_SECONDS = PING_INTERVAL_SECONDS * 3;

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "heartbeat-installation";

/** Domain columns stored next to the credential (ADR-019). */
interface HeartbeatInstallationDraft {
  label: string;
  externalRef: string | null;
}

/**
 * Presence of the installations sharing one externalRef, normalized for the
 * platform-side per-facility dashboards. Several rows can share a ref (rotation
 * history, multiple instances):
 * - `enrolled` — at least one non-revoked installation exists.
 * - `online` — a non-revoked installation pinged within the online window.
 * - `lastSeenAt` — newest ping across the non-revoked installations
 *   (null until the first contact).
 * - `revokedOnly` — rows exist but every one is revoked.
 */
export interface InstallationPresence {
  enrolled: boolean;
  online: boolean;
  lastSeenAt: Date | null;
  revokedOnly: boolean;
}

/**
 * Installation registry for the heartbeat module. One token = one deployment
 * endpoint; the host pre-creates rows and distributes the plaintext token out
 * of band, and the running process touches lastSeenAt on every ping.
 */
@Injectable()
export class HeartbeatInstallationService implements InstallationResolver {
  readonly kind = "heartbeat";
  /** Accepted during the SDK migration window; removed once all SDKs present Bearer tokens (ADR-016). */
  readonly legacyHeader = "x-heartbeat-token";

  // Credential mechanism comes from security (ADR-019); this class only adapts
  // its table and projects the domain state.
  private readonly credentials: InstallationCredentialStore<HeartbeatInstallationDraft, HeartbeatInstallation>;
  private readonly tokenVerifier: InstallationTokenVerifier<HeartbeatInstallation>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.credentials = {
      create: (draft) => this.prisma.heartbeatInstallation.create({ data: draft }),
      findByTokenHash: (tokenHash) => this.prisma.heartbeatInstallation.findUnique({ where: { tokenHash } }),
      replaceTokenHash: async (id, tokenHash) => {
        await this.prisma.heartbeatInstallation.update({ where: { id }, data: { tokenHash } });
      },
      setRevokedAt: async (id, revokedAt) => {
        await this.prisma.heartbeatInstallation.update({ where: { id }, data: { revokedAt } });
      },
    };
    this.tokenVerifier = new InstallationTokenVerifier(this.credentials);
  }

  // -------------------------------------------------------------------------
  // Installation lifecycle (host integration API)
  // -------------------------------------------------------------------------

  /** Enroll a new installation. The plaintext token is returned ONCE. */
  async create(input: { label: string; externalRef?: string }, actor?: string) {
    const { record, token } = await issueInstallationCredential(
      this.credentials,
      { label: input.label, externalRef: input.externalRef ?? null },
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
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    return rotateInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
  }

  /** Soft revocation: pings are rejected (401), rows are retained for audit. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return revokeInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
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
    const rows = await this.prisma.heartbeatInstallation.findMany({
      where: { externalRef: { in: externalRefs } },
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
        // the newest ping across the non-revoked installations sharing it.
        if (row.lastSeenAt && (!lastSeenAt || row.lastSeenAt > lastSeenAt)) {
          lastSeenAt = row.lastSeenAt;
        }
        if (row.lastSeenAt != null && now - row.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS) {
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
   * Look up a non-revoked installation by its plaintext token. Unknown and
   * revoked tokens both return null so the two cases stay indistinguishable.
   */
  async resolveByToken(token: string): Promise<HeartbeatInstallation | null> {
    return this.tokenVerifier.verify(token);
  }

  /**
   * InstallationResolver port (ADR-016): authenticate a report token for the
   * InstallationAuthGuard. Throws UnauthorizedException for unknown or
   * revoked tokens.
   */
  async resolve(token: string): Promise<HeartbeatInstallation> {
    const installation = await this.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid or revoked installation token.");
    }
    return installation;
  }

  /**
   * Advance liveness for an already-authenticated installation in a single
   * round trip. Authentication happens upstream in the InstallationAuthGuard
   * (ADR-016). firstSeenAt is written exactly once (COALESCE), lastSeenAt
   * always advances, runtime facts refresh when sent.
   */
  async recordPing(
    installationId: string,
    facts: {
      appVersion?: string;
      env?: string;
      instanceId?: string;
    },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$queryRaw`
      UPDATE "module/heartbeat"."HeartbeatInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "appVersion" = COALESCE(${facts.appVersion ?? null}, "appVersion"),
          "env" = COALESCE(${facts.env ?? null}, "env"),
          "instanceId" = COALESCE(${facts.instanceId ?? null}, "instanceId"),
          "updatedAt" = ${now}
      WHERE "id" = ${installationId}
    `;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private withDerivedState(row: HeartbeatInstallation) {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - row.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }
}
