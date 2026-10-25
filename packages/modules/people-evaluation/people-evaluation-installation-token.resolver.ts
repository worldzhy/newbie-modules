import { Injectable, UnauthorizedException } from "@nestjs/common";

import { InstallationResolver } from "@modules/security/ports/installation.resolver";
import { PeopleEvaluationInstallationService } from "./people-evaluation-installation.service";

export interface ResolvedPeopleEvaluationInstallationToken {
  installationId: string;
  /** Evaluatee the token is allowed to report for (authorization scope). */
  evaluateeUserId: string;
}

/**
 * Resolves people-evaluation installation tokens to installation rows.
 *
 * Implements security's InstallationResolver port (ADR-016) so the
 * InstallationAuthGuard can authenticate the ingest endpoints. The resolved
 * evaluateeUserId is the single authorization fact for ingest: an installation
 * agent may only write evidence for its own evaluatee.
 *
 * Verification is the shared security algorithm (ADR-019), which caches only
 * rejected tokens: revocation and rotation take effect on the very next
 * request, so evidence for a performance evaluation never keeps flowing after
 * access is withdrawn.
 */
@Injectable()
export class PeopleEvaluationInstallationTokenResolver implements InstallationResolver {
  readonly kind = "people-evaluation";

  constructor(private readonly installations: PeopleEvaluationInstallationService) {}

  async resolve(token: string): Promise<ResolvedPeopleEvaluationInstallationToken> {
    const installation = await this.installations.resolveByToken(token);
    if (!installation) {
      throw new UnauthorizedException("Invalid people-evaluation installation token.");
    }
    return { installationId: installation.id, evaluateeUserId: installation.evaluateeUserId };
  }
}
