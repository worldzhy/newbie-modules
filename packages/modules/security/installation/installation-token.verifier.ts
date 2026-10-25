import {
  InstallationCredentialLookup,
  InstallationCredentialRecord,
  hashInstallationToken,
  isInstallationTokenWellFormed,
} from "./installation-credential";

/** How long an unknown token is remembered as invalid. */
export const DEFAULT_NEGATIVE_CACHE_TTL_MS = 10_000;

/**
 * Hard cap on remembered rejections. Report endpoints are open, so random
 * token traffic must not grow the map without bound.
 */
export const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

export interface InstallationTokenVerifierOptions {
  negativeCacheTtlMs?: number;
  maxCacheEntries?: number;
  now?: () => number;
}

/**
 * Shared installation-token verification (ADR-019): format check -> SHA-256
 * hash -> indexed lookup -> revocation check.
 *
 * Positive results are deliberately NOT cached. Revocation and rotation must
 * take effect on the very next request for every collector; a positive cache
 * without a cross-instance invalidation channel would silently delay
 * revocation. Only unknown (well-formed but absent) tokens are cached, to
 * absorb garbage traffic. Revoked tokens are re-checked against storage on
 * every request, so restoring an installation also takes effect immediately.
 */
export class InstallationTokenVerifier<TRow extends InstallationCredentialRecord> {
  private readonly rejections = new Map<string, number>();
  private readonly negativeCacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly store: InstallationCredentialLookup<TRow>,
    options: InstallationTokenVerifierOptions = {},
  ) {
    this.negativeCacheTtlMs = options.negativeCacheTtlMs ?? DEFAULT_NEGATIVE_CACHE_TTL_MS;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns the installation row for a valid, non-revoked token; null for a
   * malformed, unknown or revoked one. Callers turn null into their own
   * UnauthorizedException so the message stays collector-specific.
   */
  async verify(token: string): Promise<TRow | null> {
    const now = this.now();

    if (!isInstallationTokenWellFormed(token)) return null;

    const rejectedUntil = this.rejections.get(token);
    if (rejectedUntil !== undefined) {
      if (rejectedUntil > now) return null;
      this.rejections.delete(token);
    }

    const record = await this.store.findByTokenHash(hashInstallationToken(token));
    if (!record) {
      this.reject(token, now);
      return null;
    }
    // Revoked rows are not cached: clearing the revocation marker must also
    // take effect on the next request.
    return record.revokedAt === null ? record : null;
  }

  private reject(token: string, now: number): void {
    if (this.rejections.size >= this.maxCacheEntries) {
      const oldest = this.rejections.keys().next().value;
      if (oldest !== undefined) this.rejections.delete(oldest);
    }
    this.rejections.set(token, now + this.negativeCacheTtlMs);
  }
}
