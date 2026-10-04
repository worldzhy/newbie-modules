import { Injectable, UnauthorizedException } from "@nestjs/common";

import { WebInstallationService } from "./web-installation.service";

/** Positive token cache lifetime. Tokens rarely change, so 60s saves a PG hit per batch. */
const POSITIVE_TTL_MS = 60_000;
/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
/** Minimum interval between liveness UPDATEs for one installation. */
const TOUCH_THROTTLE_MS = 30_000;
/**
 * Hard cap on cached tokens (positive + negative). The endpoint is open, so
 * random-token traffic must not grow the Map without bound.
 */
const MAX_CACHE_ENTRIES = 10_000;

/** Canonical UUID format of report tokens. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedWebToken {
  installationId: string;
  /** Immutable public partition key for downstream Mongo/ClickHouse collections. */
  appKey: string;
}

interface CachedToken {
  /** Null means the token was rejected (negative cache entry). */
  installationId: string | null;
  appKey: string | null;
  expiresAt: number;
}

/**
 * Resolves web-monitor report tokens to WebInstallation rows.
 *
 * The ingest path is high-volume, so results are cached in-process and
 * liveness writes are throttled — a revoked token may still be accepted for
 * up to POSITIVE_TTL_MS, which is acceptable here.
 */
@Injectable()
export class WebTokenResolver {
  private readonly cache = new Map<string, CachedToken>();
  private readonly lastTouchAt = new Map<string, number>();

  constructor(private readonly installations: WebInstallationService) {}

  /**
   * Validates the token and returns installationId plus appKey.
   * Throws UnauthorizedException when missing, malformed, unknown, or revoked.
   * Performs the throttled liveness touch.
   */
  async resolve(token: string | undefined): Promise<ResolvedWebToken> {
    if (!token) {
      throw new UnauthorizedException("Missing web monitor report token.");
    }

    const now = Date.now();

    // Reject malformed tokens up front to protect the open endpoint from
    // per-request PG hits (and because a non-UUID value can never match).
    if (!UUID_PATTERN.test(token)) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid web monitor report token.");
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt <= now) {
        this.cache.delete(token);
      } else if (!cached.installationId || !cached.appKey) {
        throw new UnauthorizedException("Invalid web monitor report token.");
      } else {
        await this.touch(cached.installationId);
        return { installationId: cached.installationId, appKey: cached.appKey };
      }
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid web monitor report token.");
    }

    this.cache.set(token, {
      installationId: installation.id,
      appKey: installation.appKey,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    await this.touch(installation.id);
    return { installationId: installation.id, appKey: installation.appKey };
  }

  /** Stores a negative cache entry with the size cap applied. */
  private putNegativeCache(token: string, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, {
      installationId: null,
      appKey: null,
      expiresAt: now + NEGATIVE_TTL_MS,
    });
  }

  /** Throttled liveness touch, at most once per TOUCH_THROTTLE_MS. */
  private async touch(installationId: string): Promise<void> {
    const nowMs = Date.now();
    const last = this.lastTouchAt.get(installationId) ?? 0;
    if (nowMs - last < TOUCH_THROTTLE_MS) return;
    await this.installations.touchOnReport(installationId);
    this.lastTouchAt.set(installationId, nowMs);
  }
}
