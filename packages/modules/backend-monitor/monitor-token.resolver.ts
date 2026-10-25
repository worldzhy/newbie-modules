import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { MonitorInstallationService } from "./services/monitor-installation.service";

/** Minimum interval between liveness/fact UPDATEs for one installation. */
const TOUCH_THROTTLE_MS = 30_000;

/** externalRef host-mapping convention: "projectId/applicationId". */
const EXTERNAL_REF_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f-]{36})$/i;

export interface ResolvedMonitorToken {
  installationId: string;
  /** Mapped from externalRef; stamped as application_id on ClickHouse rows. */
  applicationId: string;
}

/** Self-reported batch facts refreshed onto the installation row (throttled). */
export interface IngestFacts {
  env?: string;
  appVersion?: string;
  instanceId?: string;
  kind?: string;
}

/**
 * Resolves backend-monitor report tokens to BackendMonitorInstallation rows.
 *
 * Token verification (format, SHA-256 hash, indexed lookup, revocation) is the
 * shared security verifier (ADR-019): results are never cached positively, so
 * a revoked or rotated token is rejected on the very next request. Only the
 * liveness write remains throttled — that is a throughput concern, not a
 * credential one.
 *
 * Implements security's InstallationResolver port (ADR-016): the
 * InstallationAuthGuard calls resolve(); the throttled liveness touch runs
 * separately via touchOnIngest() once the controller's facts are parsed.
 */
@Injectable()
export class MonitorTokenResolver implements InstallationResolver {
  readonly kind = "backend-monitor";
  /** Accepted during the SDK migration window; removed once all SDKs present Bearer tokens (ADR-016). */
  readonly legacyHeader = "x-backend-monitor-token";

  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly installations: MonitorInstallationService) {}

  /**
   * Validates the token and returns installationId plus the mapped
   * applicationId. Throws UnauthorizedException when malformed, unknown,
   * revoked, or when the installation has no parseable application mapping.
   */
  async resolve(token: string): Promise<ResolvedMonitorToken> {
    const installation = await this.installations.resolveByToken(token);
    const applicationId = installation?.externalRef ? this.parseApplicationId(installation.externalRef) : null;
    if (!installation || !applicationId) {
      throw new UnauthorizedException("Invalid backend monitor report token.");
    }
    return { installationId: installation.id, applicationId };
  }

  /** Throttled liveness/fact refresh, at most once per TOUCH_THROTTLE_MS. */
  async touchOnIngest(installationId: string, facts: IngestFacts): Promise<void> {
    const nowMs = Date.now();
    const last = this.lastTouchAt.get(installationId) ?? 0;
    if (nowMs - last < TOUCH_THROTTLE_MS) return;
    await this.installations.touchOnIngest(installationId, facts);
    this.lastTouchAt.set(installationId, nowMs);
  }

  /** Extracts the applicationId segment of a "projectId/applicationId" ref. */
  private parseApplicationId(externalRef: string): string | null {
    const match = EXTERNAL_REF_PATTERN.exec(externalRef);
    return match ? match[2] : null;
  }
}
