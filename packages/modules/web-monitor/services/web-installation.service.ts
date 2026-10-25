import { Injectable, NotFoundException } from "@nestjs/common";
import { WebMonitorInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import {
  InstallationCredentialStore,
  issueInstallationCredential,
  restoreInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "@modules/security/installation/installation-credential";
import { InstallationTokenVerifier } from "@modules/security/installation/installation-token.verifier";

import { func } from "../shared/utils";

/** Reports flush near-continuously; three minutes without one marks stale. */
export const ONLINE_THRESHOLD_SECONDS = 180;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "web-monitor-installation";

/** Domain columns stored next to the credential (ADR-019). */
interface WebInstallationDraft {
  label: string;
  externalRef: string | null;
  appKey: string;
}

/**
 * Registry of web-monitor browser-SDK installations. One token = one FRONTEND
 * application reporting to /web-monitor/report with the token in the body.
 *
 * Token generation, hashing, lifecycle and verification come from security
 * (ADR-019); this class only adapts the table, mints the immutable appKey and
 * projects domain state. Replaces the retired application.Agent (WEB_MONITOR)
 * identity.
 */
@Injectable()
export class WebInstallationService {
  private readonly credentials: InstallationCredentialStore<WebInstallationDraft, WebMonitorInstallation>;
  private readonly tokenVerifier: InstallationTokenVerifier<WebMonitorInstallation>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {
    this.credentials = {
      create: (draft) => this.prisma.webMonitorInstallation.create({ data: draft }),
      findByTokenHash: (tokenHash) => this.prisma.webMonitorInstallation.findUnique({ where: { tokenHash } }),
      replaceTokenHash: async (id, tokenHash) => {
        await this.prisma.webMonitorInstallation.update({ where: { id }, data: { tokenHash } });
      },
      setRevokedAt: async (id, revokedAt) => {
        await this.prisma.webMonitorInstallation.update({ where: { id }, data: { revokedAt } });
      },
    };
    this.tokenVerifier = new InstallationTokenVerifier(this.credentials);
  }

  private withDerivedState<T extends { revokedAt: Date | null; lastSeenAt: Date | null; tokenHash: string }>(
    row: T,
  ): Omit<T, "tokenHash"> & { online: boolean } {
    const online =
      !row.revokedAt &&
      row.lastSeenAt != null &&
      Date.now() - new Date(row.lastSeenAt).getTime() <= ONLINE_THRESHOLD_SECONDS * 1000;
    const { tokenHash: _tokenHash, ...rest } = row;
    return { ...rest, online };
  }

  /**
   * Enroll a new installation. The plaintext token and the generated appKey
   * are returned ONCE; appKey is immutable across rotations because it is
   * embedded in Mongo collection / ClickHouse table names.
   */
  async create(input: { label: string; externalRef?: string }, actor?: string) {
    // func.randomString appends Date.now(); keep only the leading random part.
    const appKey = func.randomString(7).slice(0, 7);
    const { record, token } = await issueInstallationCredential(
      this.credentials,
      { label: input.label, externalRef: input.externalRef ?? null, appKey },
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
    const rows = await this.prisma.webMonitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.webMonitorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Web installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Exact-match lookup by the host-mapping tag ("projectId/applicationId"). */
  async findByExternalRef(externalRef: string) {
    return this.prisma.webMonitorInstallation.findFirst({ where: { externalRef } });
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

  /** Soft revocation: reports are rejected (401), rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return revokeInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
  }

  /** Re-enable a revoked installation by clearing the revocation marker. */
  async unrevoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return restoreInstallationCredential(this.credentials, id, {
      recorder: this.auditLogService,
      resourceType: AUDIT_RESOURCE_TYPE,
      actorId: actor,
    });
  }

  /** Token-only authentication for the report endpoint. */
  async resolveByToken(token: string) {
    return this.tokenVerifier.verify(token);
  }

  /**
   * Refresh liveness on report. firstSeenAt is written once (COALESCE).
   * Called by the resolver under a write throttle — reporting is high-volume.
   */
  async touchOnReport(id: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/web-monitor"."WebMonitorInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
