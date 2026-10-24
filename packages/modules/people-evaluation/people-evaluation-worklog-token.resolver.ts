import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { PeopleEvaluationWorklogInstallationService } from "./people-evaluation-worklog-installation.service";

/** Positive token cache lifetime; tokens rarely change. */
const POSITIVE_TTL_MS = 60_000;
/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 10_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedWorklogToken {
  installationId: string;
  /** Evaluatee the token is allowed to report for (authorization scope). */
  evaluateeUserId: string;
}

interface CachedToken {
  installationId: string | null;
  evaluateeUserId: string | null;
  expiresAt: number;
}

/**
 * Resolves people-evaluation worklog tokens to installation rows.
 *
 * Implements security's InstallationResolver port (ADR-016) so the
 * InstallationAuthGuard can authenticate the ingest endpoints. The resolved
 * evaluateeUserId is the single authorization fact for ingest: a worklog agent
 * may only write evidence for its own evaluatee.
 */
@Injectable()
export class PeopleEvaluationWorklogTokenResolver implements InstallationResolver {
  readonly kind = "people-evaluation";

  private readonly cache = new Map<string, CachedToken>();

  constructor(private readonly installations: PeopleEvaluationWorklogInstallationService) {}

  async resolve(token: string): Promise<ResolvedWorklogToken> {
    const now = Date.now();

    if (!UUID_PATTERN.test(token)) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid people-evaluation worklog token.");
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt <= now) {
        this.cache.delete(token);
      } else if (!cached.installationId || !cached.evaluateeUserId) {
        throw new UnauthorizedException("Invalid people-evaluation worklog token.");
      } else {
        return { installationId: cached.installationId, evaluateeUserId: cached.evaluateeUserId };
      }
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      this.putNegativeCache(token, now);
      throw new UnauthorizedException("Invalid people-evaluation worklog token.");
    }

    this.cache.set(token, {
      installationId: installation.id,
      evaluateeUserId: installation.evaluateeUserId,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    return { installationId: installation.id, evaluateeUserId: installation.evaluateeUserId };
  }

  private putNegativeCache(token: string, now: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(token, { installationId: null, evaluateeUserId: null, expiresAt: now + NEGATIVE_TTL_MS });
  }
}
