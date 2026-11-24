import { Injectable, NotFoundException } from "@nestjs/common";
import { Installation, InstallationKind } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { InstallationCredentialService } from "@modules/security/installation/installation-credential.service";
import { DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS } from "@modules/security/installation/installation-presence";

import { func } from "../shared/utils";

/** Reports flush near-continuously; three minutes without one marks stale. */
export const ONLINE_THRESHOLD_SECONDS = DEFAULT_INSTALLATION_ONLINE_THRESHOLD_SECONDS;

/** Liveness writes are throttled per installation: reports are high volume. */
const TOUCH_THROTTLE_MILLISECONDS = 60_000;

/** Audit resource type for installation credential events. */
const AUDIT_RESOURCE_TYPE = "frontend-monitor-installation";

const ONLINE_THRESHOLD_MILLISECONDS = ONLINE_THRESHOLD_SECONDS * 1000;

/** Projection returned by the host integration API. No credential material. */
export interface FrontendMonitorInstallationView {
  id: string;
  label: string;
  externalRef: string | null;
  appKey: string;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  online: boolean;
  createdAt: Date;
}

/**
 * Registry of frontend-monitor browser-SDK installations (ADR-019). One token
 * = one FRONTEND application reporting to /frontend-monitor/reports with the
 * token in the body.
 *
 * Identity and credential live in the shared `Installation` row (ADR-078);
 * this service mints the immutable appKey and projects domain state.
 */
@Injectable()
export class FrontendMonitorInstallationService {
  private readonly lastTouchedAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: InstallationCredentialService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Enroll a new installation. The plaintext token and the generated appKey
   * are returned ONCE; appKey is immutable across rotations because it is
   * embedded in Mongo collection / ClickHouse table names.
   */
  async create(input: { label: string; externalRef?: string }, actor?: string) {
    // func.randomString appends Date.now(); keep only the leading random part.
    const appKey = func.randomString(7).slice(0, 7);
    const { installation, token } = await this.credentials.create({
      kind: InstallationKind.FRONTEND_MONITOR,
      label: input.label,
      externalRef: input.externalRef ?? null,
      appKey,
    });
    await this.recordAudit("frontend-monitor.installation.created", installation.id, actor, {
      label: input.label,
      externalRef: input.externalRef ?? null,
    });
    return { ...this.toView(installation), token };
  }

  async list(query: { externalRef?: string }) {
    const rows = await this.prisma.installation.findMany({
      where: {
        kind: InstallationKind.FRONTEND_MONITOR,
        ...(query.externalRef ? { externalRef: query.externalRef } : {}),
      },
      orderBy: { issuedAt: "desc" },
    });
    return rows.map((row) => this.toView(row));
  }

  async getOrThrow(id: string): Promise<Installation> {
    const row = await this.prisma.installation.findFirst({
      where: { id, kind: InstallationKind.FRONTEND_MONITOR },
    });
    if (!row) throw new NotFoundException(`Web installation ${id} not found.`);
    return row;
  }

  async get(id: string) {
    return this.toView(await this.getOrThrow(id));
  }

  /** Exact-match lookup by the host-mapping tag ("projectId/applicationId"). */
  async findByExternalRef(externalRef: string): Promise<Installation | null> {
    return this.prisma.installation.findFirst({
      where: { kind: InstallationKind.FRONTEND_MONITOR, externalRef },
    });
  }

  /** Rotate the token; the old hash stops working immediately. */
  async regenerateToken(id: string, actor?: string) {
    await this.getOrThrow(id);
    const rotated = await this.credentials.rotate(id);
    await this.recordAudit("frontend-monitor.installation.token_rotated", id, actor);
    return rotated;
  }

  /** Soft revocation: reports are rejected (401), rows are retained. */
  async revoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    const revokedAt = new Date();
    await this.credentials.setRevokedAt(id, revokedAt);
    await this.recordAudit("frontend-monitor.installation.revoked", id, actor);
    return { id, revokedAt };
  }

  /** Re-enable a revoked installation by clearing the revocation marker. */
  async unrevoke(id: string, actor?: string) {
    await this.getOrThrow(id);
    await this.credentials.setRevokedAt(id, null);
    await this.recordAudit("frontend-monitor.installation.restored", id, actor);
    return { id, revokedAt: null };
  }

  /**
   * Refresh liveness on report, throttled per installation: reporting is
   * high-volume, so one write per installation per minute is enough.
   * firstSeenAt is written once (COALESCE).
   */
  async touchOnReport(id: string): Promise<void> {
    const now = Date.now();
    const last = this.lastTouchedAt.get(id) ?? 0;
    if (now - last < TOUCH_THROTTLE_MILLISECONDS) return;
    this.lastTouchedAt.set(id, now);
    await this.prisma.$executeRaw`
      UPDATE "module/security"."Installation"
      SET "firstSeenAt" = COALESCE("firstSeenAt", NOW()),
          "lastSeenAt" = NOW(),
          "updatedAt" = NOW()
      WHERE "id" = ${id}::uuid
    `;
  }

  private toView(installation: Installation): FrontendMonitorInstallationView {
    return {
      id: installation.id,
      label: installation.label,
      externalRef: installation.externalRef,
      appKey: installation.appKey ?? "",
      firstSeenAt: installation.firstSeenAt,
      lastSeenAt: installation.lastSeenAt,
      revokedAt: installation.revokedAt,
      online:
        !installation.revokedAt &&
        installation.lastSeenAt != null &&
        Date.now() - installation.lastSeenAt.getTime() <= ONLINE_THRESHOLD_MILLISECONDS,
      createdAt: installation.createdAt,
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
