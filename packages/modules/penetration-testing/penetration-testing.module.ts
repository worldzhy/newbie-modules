import { Global, Module } from "@nestjs/common";
import { EvaluationModule } from "@modules/evaluation/evaluation.module";
import { criteriaProviderToken } from "@modules/evaluation/ports/criteria.provider";
import { evidenceProviderToken } from "@modules/evaluation/ports/evidence.provider";
import { judgmentPortToken } from "@modules/evaluation/ports/judgment.port";

import { PenetrationTestingTargetService } from "./assets/penetration-testing-target.service";
import { PenetrationTestingAuthorizationService } from "./authorization/penetration-testing-authorization.service";
import { PenetrationTestingTestObjectService } from "./authorization/penetration-testing-test-object.service";
import { PenetrationTestingCriteriaProvider } from "./criteria/penetration-testing-criteria.provider";
import { PenetrationTestingCriteriaSeed } from "./criteria/penetration-testing-criteria.seed";
import { PenetrationTestingEvidenceProvider } from "./evidence/penetration-testing-evidence.provider";
import { PenetrationTestingExecutionService } from "./evidence/penetration-testing-execution.service";
import { PenetrationTestingJudgmentService } from "./judgment/penetration-testing-judgment.service";
import { PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET } from "./penetration-testing.constants";
import { PenetrationTestingRunService } from "./runs/penetration-testing-run.service";

/**
 * PenetrationTestingModule — the `web-target` feature on the evaluation skeleton
 * (ADR-075).
 *
 * Globally exported like the other evaluation features, because the host binds
 * the three host ports (scanner, destructive action, verification) from its own
 * module and the skeleton resolves the kind-scoped tokens process-wide.
 *
 * The host ports are intentionally absent here: this module must boot on a
 * deployment that has not enabled active testing. An unbound port fails the run
 * that needs it, never the application.
 */
@Global()
@Module({
  imports: [EvaluationModule],
  providers: [
    PenetrationTestingTargetService,
    PenetrationTestingAuthorizationService,
    PenetrationTestingTestObjectService,
    PenetrationTestingCriteriaSeed,
    PenetrationTestingCriteriaProvider,
    PenetrationTestingExecutionService,
    PenetrationTestingEvidenceProvider,
    PenetrationTestingJudgmentService,
    PenetrationTestingRunService,
    {
      provide: criteriaProviderToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
      useExisting: PenetrationTestingCriteriaProvider,
    },
    {
      provide: evidenceProviderToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
      useExisting: PenetrationTestingEvidenceProvider,
    },
    {
      provide: judgmentPortToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
      useExisting: PenetrationTestingJudgmentService,
    },
  ],
  exports: [
    PenetrationTestingTargetService,
    PenetrationTestingAuthorizationService,
    PenetrationTestingTestObjectService,
    PenetrationTestingExecutionService,
    PenetrationTestingCriteriaSeed,
    PenetrationTestingRunService,
    criteriaProviderToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
    evidenceProviderToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
    judgmentPortToken(PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET),
  ],
})
export class PenetrationTestingModule {}
