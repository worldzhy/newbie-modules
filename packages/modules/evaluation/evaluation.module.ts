import { Global, Module } from "@nestjs/common";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationDecisionController } from "./evaluation-decision.controller";
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
 * The module owns the seven tables, the run lifecycle and the invariants. Its
 * HTTP surface is deliberately minimal (ADR-029): the decision controller for
 * suppression/reopening, result review (ADR-031) and remediation — lifecycle
 * operations over skeleton-owned aggregates that every feature evaluationKey shares.
 * Read models, feature-specific endpoints and scheduling belong to the feature
 * that builds on it.
 *
 * `EvaluationRunnerService.run` is the only write entry of the run lifecycle —
 * it owns the heartbeat, the fencing checks and the state machine transitions.
 * The other exported services are for reads, criteria administration and human
 * decisions (suppression, result review, remediation); a feature must not
 * drive the run state machine through `EvaluationRunService` directly.
 *
 * The four ports (SubjectProvider, EvidenceProvider, CriteriaProvider,
 * JudgmentPort) are bound by the host and by features under the tokens in
 * `ports/`; the optional EvaluationObserver port reports run completions and
 * finding lifecycle changes to whoever binds it. Runner tuning goes through
 * `evaluationRunOptionsToken`. This module only ever looks bindings up.
 */
@Global()
@Module({
  controllers: [EvaluationDecisionController],
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
