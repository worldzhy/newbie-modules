import { Global, Module } from "@nestjs/common";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";

import { PeopleEvaluationController } from "./people-evaluation.controller";
import { PeopleEvaluationSessionStore } from "./people-evaluation-session.store";
import { PeopleEvaluationService } from "./people-evaluation.service";
import { PeopleEvaluationWorklogInstallationController } from "./controllers/worklog-installation.controller";
import { PeopleEvaluationWorklogController } from "./controllers/worklog.controller";
import { PeopleEvaluationWorklogInstallationService } from "./people-evaluation-worklog-installation.service";
import { PeopleEvaluationWorklogTokenResolver } from "./people-evaluation-worklog-token.resolver";

/**
 * PeopleEvaluationModule (ADR-029).
 *
 * Server surface for the evidence-driven evaluation. The module owns:
 * - rubric / period / home-ground administration and read APIs,
 * - worklog enrollment (one token per evaluatee installation, soft revocation),
 * - the token-authenticated ingest endpoints (session index → PG, transcript → ClickHouse).
 *
 * It deliberately does NOT judge: evidence packets and assessments are written
 * by the consuming project's application layer, which has access to the
 * platform APIs and the LLM module.
 */
@Global()
@Module({
  controllers: [
    PeopleEvaluationController,
    PeopleEvaluationWorklogInstallationController,
    PeopleEvaluationWorklogController,
  ],
  providers: [
    PeopleEvaluationService,
    PeopleEvaluationWorklogInstallationService,
    PeopleEvaluationSessionStore,
    PeopleEvaluationWorklogTokenResolver,
    // Bind the worklog token resolver to security's SPI port (ADR-016).
    // useExisting keeps the singleton so the token cache is never duplicated.
    {
      provide: installationResolverToken("people-evaluation"),
      useExisting: PeopleEvaluationWorklogTokenResolver,
    },
  ],
  exports: [
    PeopleEvaluationService,
    PeopleEvaluationWorklogInstallationService,
    PeopleEvaluationSessionStore,
    installationResolverToken("people-evaluation"),
  ],
})
export class PeopleEvaluationModule {}
