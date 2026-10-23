import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { PeopleEvaluationInstallationService } from "./people-evaluation-installation.service";

/** Positive token cache lifetime; tokens rarely change. */
const POSITIVE_TTL_MS = 60_000;
/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 10_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedPeopleCollectorToken {
  installationId: string;
  /** Member the token is allowed to report for (authorization scope). */
  memberUserId: string;
}

interface CachedToken {
  installationId: string | null;
  memberUserId: string | null;
  expiresAt: number;
}

/**
 * Resolves people-evaluation collector tokens to installation rows.
 *
 * Implements security's InstallationResolver port (ADR-016) so the
 * InstallationAuthGuard can authenticate the ingest endpoints. The resolved
 * memberUserId is the single authorization fact for ingest: a collector may
 * only write evidence for its own member.
 */
@Injectable()
export class PeopleEvaluationTokenResolver implements InstallationResolver {
  readonly kind = "people-evaluation";

  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly installations: PeopleEvaluationInstallationService) {}

  async resolve(token: string): Promise<ResolvedPeopleCollectorToken> {
    const now = Date.now();

    if (!UUID_PATTERN.test(token)) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid people-evaluation collector token.");
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt <= now) {
        this.cache.delete(token);
      } else if (!cached.installationId || !cached.memberUserId) {
        throw new UnauthorizedException("Invalid people-evaluation collector token.");
      } else {
        return { installationId: cached.installationId, memberUserId: cached.memberUserId };
      }
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid people-evaluation collector token.");
    }

    this.cache.set(token, {
      installationId: installation.id,
      memberUserId: installation.memberUserId,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return { installationId: installation.id, memberUserId: installation.memberUserId };
  }

  private putNegativeCache(token: string, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, { installationId: null, memberUserId: null, expiresAt: now + NEGATIVE_TTL_MS });
  }
}
