import { Global, Module } from "@nestjs/common";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationFindingService } from "./evaluation-finding.service";
import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationRemediationService } from "./evaluation-remediation.service";
import { EvaluationResultService } from "./evaluation-result.service";
import { EvaluationRunService } from "./evaluation-run.service";
import { EvaluationRunnerService } from "./evaluation-runner.service";
import { EvaluationSubjectService } from "./evaluation-subject.service";

/**
 * EvaluationModule (ADR-020) — the capability skeleton.
 *
 * The module owns the seven tables, the run lifecycle and the invariants. It
 * deliberately exposes no HTTP surface: endpoints, read models and scheduling
 * belong to the feature that builds on it.
 *
 * The four ports (SubjectProvider, EvidenceProvider, CriteriaProvider,
 * JudgmentPort) are bound by the host and by features under the tokens in
 * `ports/`; this module only looks them up.
 */
@Global()
@Module({
  providers: [
    EvaluationProviderRegistry,
    EvaluationCriteriaService,
    EvaluationSubjectService,
    EvaluationRunService,
    EvaluationResultService,
    EvaluationFindingService,
    EvaluationRemediationService,
    EvaluationRunnerService,
  ],
  exports: [
    EvaluationProviderRegistry,
    EvaluationCriteriaService,
    EvaluationSubjectService,
    EvaluationRunService,
    EvaluationResultService,
    EvaluationFindingService,
    EvaluationRemediationService,
    EvaluationRunnerService,
  ],
})
export class EvaluationModule {}
