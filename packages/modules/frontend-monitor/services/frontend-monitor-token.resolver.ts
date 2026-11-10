import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationTouchThrottle } from "@modules/security/installation/installation-touch-throttle";
import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { FrontendMonitorInstallationService } from "./frontend-monitor-installation.service";

export interface ResolvedWebToken {
  installationId: string;
  /** Immutable public partition key for downstream Mongo/ClickHouse collections. */
  appKey: string;
}

/**
 * Resolves frontend-monitor report tokens to FrontendMonitorInstallation rows.
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
export class FrontendMonitorTokenResolver implements InstallationResolver {
  readonly kind = "frontend-monitor";
  /** sendBeacon cannot set headers, so the body token IS the standard (ADR-016 documented exception). */
  readonly bodyTokenField = "token";

  private readonly touchThrottle = new InstallationTouchThrottle();

  constructor(private readonly installations: FrontendMonitorInstallationService) {}

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

  /** Throttled liveness touch, at most once per throttle interval. */
  async touchOnReport(installationId: string): Promise<void> {
    await this.touchThrottle.runIfDue(installationId, () => this.installations.touchOnReport(installationId));
  }
}
