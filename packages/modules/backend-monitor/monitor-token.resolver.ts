import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { Installation } from "@generated/prisma/client";
import { InstallationTouchThrottle } from "@modules/security/installation/installation-touch-throttle";
import { MonitorApplicationRefResolver, monitorApplicationRefResolverToken } from "./ports/application-ref.resolver";
import { MonitorInstallationService } from "./services/monitor-installation.service";

export interface ResolvedMonitorToken {
  installationId: string;
  /** Resolved via the host-bound MonitorApplicationRefResolver; stamped as application_id on ClickHouse rows. */
  applicationId: string;
}

/** Self-reported batch facts refreshed onto the installation fact row (throttled). */
export interface IngestFacts {
  env?: string;
  appVersion?: string;
  instanceId?: string;
  runtime?: string;
}

/**
 * Maps an authenticated installation to the identity stamped on ClickHouse
 * rows.
 *
 * Token verification (format, SHA-256 hash, indexed lookup, revocation, kind)
 * is the shared InstallationAuthGuard (ADR-078), which puts the resolved
 * `Installation` on the request. This class only resolves the host-bound
 * application identity and keeps the liveness write throttled — that is a
 * throughput concern, not a credential one.
 */
@Injectable()
export class MonitorTokenResolver {
  private readonly touchThrottle = new InstallationTouchThrottle();

  constructor(
    private readonly installations: MonitorInstallationService,
    @Inject(monitorApplicationRefResolverToken)
    private readonly applicationRefs: MonitorApplicationRefResolver,
  ) {}

  /**
   * Returns installationId plus the resolved applicationId. Throws
   * UnauthorizedException when the installation has no mappable application
   * identity.
   */
  resolveForIngest(installation: Installation): ResolvedMonitorToken {
    const applicationId = installation.externalRef
      ? this.applicationRefs.resolveApplicationId(installation.externalRef)
      : null;
    if (!applicationId) {
      throw new UnauthorizedException("Invalid backend monitor report token.");
    }
    return { installationId: installation.id, applicationId };
  }

  /** Throttled liveness/fact refresh, at most once per throttle interval. */
  async touchOnIngest(installationId: string, facts: IngestFacts): Promise<void> {
    await this.touchThrottle.runIfDue(installationId, () => this.installations.touchOnIngest(installationId, facts));
  }
}
