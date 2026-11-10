import { Injectable, NotFoundException } from "@nestjs/common";
import { FrontendMonitorInstallation } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import {
  InstallationCredentialAudit,
  InstallationCredentialStore,
  issueInstallationCredential,
  restoreInstallationCredential,
  revokeInstallationCredential,
  rotateInstallationCredential,
} from "@modules/security/installation/installation-credential";
import { prismaInstallationCredentialStore } from "@modules/security/installation/prisma-installation-credential-store";
import { InstallationTokenVerifier } from "@modules/security/installation/installation-token.verifier";
import { BaseInstallationService } from "@modules/security/installation/base-installation.service";
import {
  DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS,
  withDerivedOnlineState,
} from "@modules/security/installation/installation-presence";

import { func } from "../shared/utils";

/** Reports flush near-continuously; three minutes without one marks stale. */
export const ONLINE_THRESHOLD_SECONDS = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "frontend-monitor-installation";

/** Domain columns stored next to the credential (ADR-019). */
interface FrontendInstallationDraft {
  label: string;
  externalRef: string | null;
  appKey: string;
}

/**
 * Registry of frontend-monitor browser-SDK installations. One token = one FRONTEND
 * application reporting to /frontend-monitor/report with the token in the body.
 *
 * Token generation, hashing, lifecycle and verification come from security
 * (ADR-019); this class only adapts the table, mints the immutable appKey and
 * projects domain state. Replaces the retired application.Agent (FRONTEND_MONITOR)
 * identity.
 */
@Injectable()
export class FrontendInstallationService extends BaseInstallationService<FrontendMonitorInstallation> {
  private readonly credentials: InstallationCredentialStore<FrontendInstallationDraft, FrontendMonitorInstallation>;
  protected readonly tokenVerifier: InstallationTokenVerifier<FrontendMonitorInstallation>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {
    super();
    this.credentials = prismaInstallationCredentialStore<FrontendInstallationDraft, FrontendMonitorInstallation>(
      this.prisma.frontendMonitorInstallation,
    );
    this.tokenVerifier = new InstallationTokenVerifier(this.credentials);
  }

  private credentialAudit(actor?: string): InstallationCredentialAudit {
    return { recorder: this.auditLogService, resourceType: AUDIT_RESOURCE_TYPE, actorId: actor };
  }

  private withDerivedState<T extends { revokedAt: Date | null; lastSeenAt: Date | null; tokenHash: string }>(
    row: T,
  ): Omit<T, "tokenHash"> & { online: boolean } {
    return withDerivedOnlineState(row, ONLINE_THRESHOLD_SECONDS);
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
        ...this.credentialAudit(actor),
        detail: { label: input.label, externalRef: input.externalRef ?? null },
      },
    );
    return { ...this.withDerivedState(record), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.frontendMonitorInstallation.findMany({
      where: query.externalRef ? { externalRef: query.externalRef } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.withDerivedState(row));
  }

  async getOrThrow(id: string) {
    const row = await this.prisma.frontendMonitorInstallation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Web installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.withDerivedState(await this.getOrThrow(id));
  }

  /** Exact-match lookup by the host-mapping tag ("projectId/applicationId"). */
  async findByExternalRef(externalRef: string) {
    return this.prisma.frontendMonitorInstallation.findFirst({ where: { externalRef } });
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    return rotateInstallationCredential(this.credentials, id, this.credentialAudit(actor));
  }

  /** Soft revocation: reports are rejected (401), rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return revokeInstallationCredential(this.credentials, id, this.credentialAudit(actor));
  }

  /** Re-enable a revoked installation by clearing the revocation marker. */
  async unrevoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    return restoreInstallationCredential(this.credentials, id, this.credentialAudit(actor));
  }

  /**
   * Refresh liveness on report. firstSeenAt is written once (COALESCE).
   * Called by the resolver under a write throttle — reporting is high-volume.
   */
  async touchOnReport(id: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "module/frontend-monitor"."FrontendMonitorInstallation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", ${now}),
          "lastSeenAt" = ${now},
          "updatedAt" = ${now}
      WHERE "id" = ${id}::uuid
    `;
  }
}
