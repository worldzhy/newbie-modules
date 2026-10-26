import { Global, Module } from "@nestjs/common";
import { EvaluationModule } from "@modules/evaluation/evaluation.module";
import { criteriaProviderToken } from "@modules/evaluation/ports/criteria.provider";
import { evidenceProviderToken } from "@modules/evaluation/ports/evidence.provider";
import { judgmentPortToken } from "@modules/evaluation/ports/judgment.port";

import { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationAssetSyncService } from "./assets/security-evaluation-asset-sync.service";
import { SecurityEvaluationCriteriaProvider } from "./criteria/security-evaluation-criteria.provider";
import { SecurityEvaluationCriteriaSeed } from "./criteria/security-evaluation-criteria.seed";
import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import { SecurityEvaluationDependencyJudgment } from "./judgment/dependency/security-evaluation-dependency.judgment";
import { SecurityEvaluationOsvClient } from "./judgment/dependency/security-evaluation-osv.client";
import { SecurityEvaluationJudgmentService } from "./judgment/security-evaluation-judgment.service";
import { SecurityEvaluationReportService } from "./reporting/security-evaluation-report.service";
import { SecurityEvaluationController } from "./security-evaluation.controller";
import { SecurityEvaluationRunService } from "./security-evaluation-run.service";
import { SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY } from "./security-evaluation.constants";

/**
 * SecurityEvaluationModule (ADR-022) — the security feature on the evaluation
 * skeleton (ADR-020), shipped as the second feature after work-evaluation.
 *
 * Slice 1 owns:
 * - the asset inventory (`SecurityEvaluationAsset` / `SecurityEvaluationAssetFact`)
 *   materialised from the skeleton's subjects,
 * - the code-defined dependency criteria and their idempotent publication,
 * - the DEPENDENCY judgment: lockfile evidence into OSV, deterministic findings,
 * - the single-axis report read model.
 *
 * The run lifecycle, result immutability, finding lifecycle and subject registry
 * belong to the skeleton; this module only implements the ports and the HTTP
 * surface. Port bindings use `useExisting` so the singletons are never
 * duplicated (the registry resolves the ports by token from the global
 * container). CLOUD_CONFIG and INTEL arrive in later slices and will add their
 * own family dispatch, not new port bindings.
 *
 * `SECURITY_EVALUATION_REPOSITORY_ACCESS` is intentionally not bound here: the
 * host binds it (nightwatch uses its github module). An unbound port fails the
 * run with a wiring error rather than silently reporting a clean result.
 */
@Global()
@Module({
  imports: [EvaluationModule],
  controllers: [SecurityEvaluationController],
  providers: [
    SecurityEvaluationAssetService,
    SecurityEvaluationAssetSyncService,
    SecurityEvaluationCriteriaSeed,
    SecurityEvaluationCriteriaProvider,
    SecurityEvaluationEvidenceProvider,
    SecurityEvaluationOsvClient,
    SecurityEvaluationDependencyJudgment,
    SecurityEvaluationJudgmentService,
    SecurityEvaluationRunService,
    SecurityEvaluationReportService,
    // Kind-scoped skeleton ports for the kind this slice judges (ADR-020 D4).
    {
      provide: criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationCriteriaProvider,
    },
    {
      provide: evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationEvidenceProvider,
    },
    {
      provide: judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
      useExisting: SecurityEvaluationJudgmentService,
    },
  ],
  exports: [
    SecurityEvaluationAssetService,
    SecurityEvaluationAssetSyncService,
    SecurityEvaluationRunService,
    SecurityEvaluationReportService,
    criteriaProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
    evidenceProviderToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
    judgmentPortToken(SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY),
  ],
})
export class SecurityEvaluationModule {}
