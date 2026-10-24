import { Global, Module } from "@nestjs/common";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";

import { PeopleEvaluationController } from "./people-evaluation.controller";
import { PeopleEvaluationSessionStore } from "./people-evaluation-session.store";
import { PeopleEvaluationRubricService } from "./people-evaluation-rubric.service";
import { PeopleEvaluationEvidenceService } from "./people-evaluation-evidence.service";
import { PeopleEvaluationResultService } from "./people-evaluation-result.service";
import { PeopleEvaluationInstallationController } from "./controllers/installation.controller";
import { PeopleEvaluationEvidenceController } from "./controllers/evidence.controller";
import { PeopleEvaluationInstallationService } from "./people-evaluation-installation.service";
import { PeopleEvaluationInstallationTokenResolver } from "./people-evaluation-installation-token.resolver";

/**
 * PeopleEvaluationModule (ADR-029).
 *
 * Server surface for the evidence-driven evaluation. The module owns:
 * - rubric / period / home-ground administration and read APIs,
 * - installation enrollment (one token per evaluatee installation, soft revocation),
 * - the token-authenticated ingest endpoints (session index → PG, transcript → ClickHouse).
 *
 * It deliberately does NOT judge: evidence manifests and evaluation results are written
 * by the consuming project's application layer, which has access to the
 * platform APIs and the LLM module.
 */
@Global()
@Module({
  controllers: [PeopleEvaluationController, PeopleEvaluationInstallationController, PeopleEvaluationEvidenceController],
  providers: [
    PeopleEvaluationRubricService,
    PeopleEvaluationEvidenceService,
    PeopleEvaluationResultService,
    PeopleEvaluationInstallationService,
    PeopleEvaluationSessionStore,
    PeopleEvaluationInstallationTokenResolver,
    // Bind the installation token resolver to security's SPI port (ADR-016).
    // useExisting keeps the singleton so the rejection cache is never duplicated.
    {
      provide: installationResolverToken("people-evaluation"),
      useExisting: PeopleEvaluationInstallationTokenResolver,
    },
  ],
  exports: [
    PeopleEvaluationRubricService,
    PeopleEvaluationEvidenceService,
    PeopleEvaluationResultService,
    PeopleEvaluationInstallationService,
    PeopleEvaluationSessionStore,
    installationResolverToken("people-evaluation"),
  ],
})
export class PeopleEvaluationModule {}
