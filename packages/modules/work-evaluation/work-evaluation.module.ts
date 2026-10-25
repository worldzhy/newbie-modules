import { Global, Module } from "@nestjs/common";
import { EvaluationModule } from "@modules/evaluation/evaluation.module";
import { criteriaProviderToken } from "@modules/evaluation/ports/criteria.provider";
import { evidenceProviderToken } from "@modules/evaluation/ports/evidence.provider";
import { judgmentPortToken } from "@modules/evaluation/ports/judgment.port";
import { installationResolverToken } from "@modules/security/ports/installation.resolver";

import { WorkEvaluationController } from "./work-evaluation.controller";
import { WorkEvaluationInstallationController } from "./controllers/installation.controller";
import { WorkEvaluationEvidenceController } from "./controllers/evidence.controller";
import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { WorkEvaluationEvidenceService } from "./work-evaluation-evidence.service";
import { WorkEvaluationSessionStore } from "./work-evaluation-session.store";
import { WorkEvaluationInstallationService } from "./work-evaluation-installation.service";
import { WorkEvaluationInstallationTokenResolver } from "./work-evaluation-installation-token.resolver";
import { WorkEvaluationCriteriaProvider } from "./work-evaluation-criteria.provider";
import { WorkEvaluationEvidenceProvider } from "./work-evaluation-evidence.provider";
import { WorkEvaluationJudgmentService } from "./work-evaluation-judgment.service";
import { WorkEvaluationJudgmentTools } from "./work-evaluation-judgment.tools";
import { WorkEvaluationRunService } from "./work-evaluation-run.service";
import { WORK_EVALUATION_SUBJECT_KIND } from "./work-evaluation.constants";

/**
 * WorkEvaluationModule (ADR-024) — the first feature on the evaluation
 * skeleton (ADR-020), replacing the frozen predecessor module.
 *
 * The module owns:
 * - period / home-ground administration and criteria-version administration
 *   for subject kind "work",
 * - installation enrollment (one token per evaluatee installation, soft
 *   revocation) and the token-authenticated ingest endpoints
 *   (session index → PG, transcript → ClickHouse),
 * - the three kind-scoped skeleton ports: criteria selection, evidence
 *   collection and the three-phase judgment.
 *
 * The run lifecycle, result immutability and the subject registry belong to
 * the skeleton; this module only implements the ports and the HTTP surface.
 * Port bindings and the installation token resolver use `useExisting` so the
 * singletons are never duplicated (the resolver's rejection cache must stay
 * single, and the registry resolves the ports by token from the global
 * container).
 */
@Global()
@Module({
  imports: [EvaluationModule],
  controllers: [WorkEvaluationController, WorkEvaluationInstallationController, WorkEvaluationEvidenceController],
  providers: [
    WorkEvaluationPeriodService,
    WorkEvaluationEvidenceService,
    WorkEvaluationSessionStore,
    WorkEvaluationInstallationService,
    WorkEvaluationInstallationTokenResolver,
    WorkEvaluationCriteriaProvider,
    WorkEvaluationEvidenceProvider,
    WorkEvaluationJudgmentTools,
    WorkEvaluationJudgmentService,
    WorkEvaluationRunService,
    // Bind the installation token resolver to security's SPI port (ADR-016).
    {
      provide: installationResolverToken("work-evaluation"),
      useExisting: WorkEvaluationInstallationTokenResolver,
    },
    // Kind-scoped skeleton ports for subject kind "work" (ADR-020 D4).
    {
      provide: criteriaProviderToken(WORK_EVALUATION_SUBJECT_KIND),
      useExisting: WorkEvaluationCriteriaProvider,
    },
    {
      provide: evidenceProviderToken(WORK_EVALUATION_SUBJECT_KIND),
      useExisting: WorkEvaluationEvidenceProvider,
    },
    {
      provide: judgmentPortToken(WORK_EVALUATION_SUBJECT_KIND),
      useExisting: WorkEvaluationJudgmentService,
    },
  ],
  exports: [
    WorkEvaluationPeriodService,
    WorkEvaluationEvidenceService,
    WorkEvaluationSessionStore,
    WorkEvaluationInstallationService,
    WorkEvaluationRunService,
    installationResolverToken("work-evaluation"),
    criteriaProviderToken(WORK_EVALUATION_SUBJECT_KIND),
    evidenceProviderToken(WORK_EVALUATION_SUBJECT_KIND),
    judgmentPortToken(WORK_EVALUATION_SUBJECT_KIND),
  ],
})
export class WorkEvaluationModule {}
