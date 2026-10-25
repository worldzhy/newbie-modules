import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { WebInstallationService } from "./web-installation.service";

/** Minimum interval between liveness UPDATEs for one installation. */
const TOUCH_THROTTLE_MS = 30_000;

export interface ResolvedWebToken {
  installationId: string;
  /** Immutable public partition key for downstream Mongo/ClickHouse collections. */
  appKey: string;
}

/**
 * Resolves web-monitor report tokens to WebMonitorInstallation rows.
 *
 * Token verification (format, SHA-256 hash, indexed lookup, revocation) is the
 * shared security verifier (ADR-019): results are never cached positively, so
 * a revoked or rotated token is rejected on the very next request. Only the
 * liveness write remains throttled — a throughput concern, not a credential
 * one.
 *
 * Implements security's InstallationResolver port (ADR-016): the
 * InstallationAuthGuard calls resolve(); the throttled liveness touch runs
 * separately via touchOnReport() once the controller's payload is parsed.
 * The token arrives in the request body (bodyTokenField "token") because the
 * browser SDK posts via navigator.sendBeacon, which cannot set headers.
 */
@Injectable()
export class WebTokenResolver implements InstallationResolver {
  readonly kind = "web-monitor";
  /** sendBeacon cannot set headers, so the body token IS the standard (ADR-016 documented exception). */
  readonly bodyTokenField = "token";

  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly installations: WebInstallationService) {}

  /**
   * Validates the token and returns installationId plus appKey.
   * Throws UnauthorizedException when malformed, unknown, or revoked.
   */
  async resolve(token: string): Promise<ResolvedWebToken> {
    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid web monitor report token.");
    }
    return { installationId: installation.id, appKey: installation.appKey };
  }

  /** Throttled liveness touch, at most once per TOUCH_THROTTLE_MS. */
  async touchOnReport(installationId: string): Promise<void> {
    const nowMs = Date.now();
    const last = this.lastTouchAt.get(installationId) ?? 0;
    if (nowMs - last < TOUCH_THROTTLE_MS) return;
    await this.installations.touchOnReport(installationId);
    this.lastTouchAt.set(installationId, nowMs);
  }
}
