import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { PeopleEvaluationWorklogInstallationService } from "./people-evaluation-worklog-installation.service";

/** Negative cache lifetime: invalid tokens are rejected without hammering PG. */
const NEGATIVE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 10_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedWorklogToken {
  installationId: string;
  /** Evaluatee the token is allowed to report for (authorization scope). */
  evaluateeUserId: string;
}

interface CachedRejection {
  expiresAt: number;
}

/**
 * Resolves people-evaluation worklog tokens to installation rows.
 *
 * Implements security's InstallationResolver port (ADR-016) so the
 * InstallationAuthGuard can authenticate the ingest endpoints. The resolved
 * evaluateeUserId is the single authorization fact for ingest: a worklog agent
 * may only write evidence for its own evaluatee.
 *
 * Valid tokens are deliberately not cached: revocation and rotation must take
 * effect on the very next request, and evidence for a performance evaluation
 * must not keep flowing after access is withdrawn. Ingest is a low-frequency
 * batched writer, so one indexed lookup per request is negligible; only
 * rejected tokens are cached, to absorb garbage traffic.
 */
@Injectable()
export class PeopleEvaluationWorklogTokenResolver implements InstallationResolver {
  readonly kind = "people-evaluation";

  private readonly rejections = new Map<string, CachedRejection>();

  constructor(private readonly installations: PeopleEvaluationWorklogInstallationService) {}

  async resolve(token: string): Promise<ResolvedWorklogToken> {
    const now = Date.now();

    if (!UUID_PATTERN.test(token)) {
      this.reject(token, now);
      throw new UnauthorizedException("Invalid people-evaluation worklog token.");
    }

    const rejection = this.rejections.get(token);
    if (rejection) {
      if (rejection.expiresAt <= now) {
        this.rejections.delete(token);
      } else {
        throw new UnauthorizedException("Invalid people-evaluation worklog token.");
      }
    }

    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      this.reject(token, now);
      throw new UnauthorizedException("Invalid people-evaluation worklog token.");
    }

    return { installationId: installation.id, evaluateeUserId: installation.evaluateeUserId };
  }

  private reject(token: string, now: number): void {
    if (this.rejections.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.rejections.keys().next().value;
      if (oldest !== undefined) this.rejections.delete(oldest);
    }
    this.rejections.set(token, { expiresAt: now + NEGATIVE_TTL_MS });
  }
}
