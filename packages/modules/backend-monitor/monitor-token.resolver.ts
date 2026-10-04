import { Injectable, UnauthorizedException } from "@nestjs/common";

import { MonitorInstallationService } from "./services/monitor-installation.service";

/** Positive token cache lifetime. Tokens rarely change, so 60s saves a PG hit per batch. */
const POSITIVE_TTL_MS = 60_000;
/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
/** Minimum interval between liveness/fact UPDATEs for one installation. */
const TOUCH_THROTTLE_MS = 30_000;
/**
 * Hard cap on cached tokens (positive + negative). The endpoint is open, so
 * random-token traffic must not grow the Map without bound.
 */
const MAX_CACHE_ENTRIES = 10_000;

/** Canonical UUID format of report tokens. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** externalRef host-mapping convention: "projectId/applicationId". */
const EXTERNAL_REF_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f-]{36})$/i;

export interface ResolvedMonitorToken {
  installationId: string;
  /** Mapped from externalRef; stamped as application_id on ClickHouse rows. */
  applicationId: string;
}

interface CachedToken {
  /** Null means the token was rejected (negative cache entry). */
  installationId: string | null;
  applicationId: string | null;
  expiresAt: number;
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
 * Phase 3 pilot (module-hub design §9.2): ingest no longer reads
 * application.Agent (SERVER_MONITOR). Tokens are random UUIDs hashed with
 * SHA-256 in the module's own BackendMonitorInstallation table; the application_id
 * dimension is derived from the opaque host externalRef
 * ("projectId/applicationId"). The ingest path is high-volume, so results are
 * cached in-process and liveness writes are throttled — a revoked token may
 * still be accepted for up to POSITIVE_TTL_MS, which is acceptable here.
 */
@Injectable()
export class MonitorTokenResolver {
  private readonly cache = new Map<string, CachedToken>();
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly installations: MonitorInstallationService) {}

  /**
   * Validates the token and returns installationId plus the mapped
   * applicationId. Throws UnauthorizedException when missing, malformed,
   * unknown, revoked, or when the installation has no parseable application
   * mapping. Performs the throttled liveness touch.
   */
  async resolve(token: string | undefined, facts: IngestFacts): Promise<ResolvedMonitorToken> {
    if (!token) {
      throw new UnauthorizedException("Missing backend monitor report token.");
    }

    const now = Date.now();

    // Reject malformed tokens up front to protect the open endpoint from
    // per-request PG hits (and because a non-UUID value can never match).
    if (!UUID_PATTERN.test(token)) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid backend monitor report token.");
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt <= now) {
        this.cache.delete(token);
      } else if (!cached.installationId || !cached.applicationId) {
        throw new UnauthorizedException("Invalid backend monitor report token.");
      } else {
        await this.touch(cached.installationId, facts);
        return { installationId: cached.installationId, applicationId: cached.applicationId };
      }
    }

    const installation = await this.installations.resolveByToken(token);
    const applicationId = installation?.externalRef ? this.parseApplicationId(installation.externalRef) : null;
    if (!installation || !applicationId) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid backend monitor report token.");
    }

    this.cache.set(token, {
      installationId: installation.id,
      applicationId,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    await this.touch(installation.id, facts);
    return { installationId: installation.id, applicationId };
  }

  /** Extracts the applicationId segment of a "projectId/applicationId" ref. */
  private parseApplicationId(externalRef: string): string | null {
    const match = EXTERNAL_REF_PATTERN.exec(externalRef);
    return match ? match[2] : null;
  }

  /** Stores a negative cache entry with the size cap applied. */
  private putNegativeCache(token: string, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, {
      installationId: null,
      applicationId: null,
      expiresAt: now + NEGATIVE_TTL_MS,
    });
  }

  /** Throttled liveness/fact refresh, at most once per TOUCH_THROTTLE_MS. */
  private async touch(installationId: string, facts: IngestFacts): Promise<void> {
    const nowMs = Date.now();
    const last = this.lastTouchAt.get(installationId) ?? 0;
    if (nowMs - last < TOUCH_THROTTLE_MS) return;
    await this.installations.touchOnIngest(installationId, facts);
    this.lastTouchAt.set(installationId, nowMs);
  }
}
