import { Global, Module } from "@nestjs/common";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";

import { PeopleEvaluationCollectorController } from "./controllers/collector.controller";
import { PeopleEvaluationInstallationController } from "./controllers/installation.controller";
import { PeopleEvaluationController } from "./people-evaluation.controller";
import { PeopleEvaluationInstallationService } from "./people-evaluation-installation.service";
import { PeopleEvaluationService } from "./people-evaluation.service";
import { PeopleEvaluationSessionStore } from "./people-evaluation-session.store";
import { PeopleEvaluationTokenResolver } from "./people-evaluation-token.resolver";

/**
 * PeopleEvaluationModule (ADR-029).
 *
 * Server surface for the evidence-driven evaluation. The module owns:
 * - rubric / period / home-ground administration and read APIs,
 * - collector enrollment (one token per member installation, soft revocation),
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
    PeopleEvaluationInstallationController,
    PeopleEvaluationCollectorController,
  ],
  providers: [
    PeopleEvaluationService,
    PeopleEvaluationInstallationService,
    PeopleEvaluationSessionStore,
    PeopleEvaluationTokenResolver,
    // Bind the collector token resolver to security's SPI port (ADR-016).
    // useExisting keeps the singleton so the token cache is never duplicated.
    { provide: installationResolverToken("people-evaluation"), useExisting: PeopleEvaluationTokenResolver },
  ],
  exports: [
    PeopleEvaluationService,
    PeopleEvaluationInstallationService,
    PeopleEvaluationSessionStore,
    installationResolverToken("people-evaluation"),
  ],
})
export class PeopleEvaluationModule {}
