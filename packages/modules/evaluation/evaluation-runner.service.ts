import { Injectable } from "@nestjs/common";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import { EvaluationFindingService } from "./evaluation-finding.service";
import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationResultService } from "./evaluation-result.service";
import { EvaluationRunService, StartEvaluationRunInput } from "./evaluation-run.service";
import { EvaluationSubjectService, toSubjectRef } from "./evaluation-subject.service";
import { EvaluationCriteriaVersionRef } from "./ports/evaluation.contracts";
import { composeCoverageStats } from "./evaluation-invariants";

export interface EvaluationRunOutcome {
  runId: string;
  resultId: string;
  findingIds: string[];
  resolvedFindingCount: number;
}

/**
 * EvaluationRunnerService — the lifecycle every feature gets for free
 * (ADR-020: "implement the four ports and inherit the lifecycle").
 *
 * Order matters: the run row is opened before any work (so concurrency is
 * decided by the database), the result is persisted before the run is marked
 * succeeded, and findings are recorded before absent ones are resolved so a
 * reappearing problem is not closed in the same pass.
 */
@Injectable()
export class EvaluationRunnerService {
  constructor(
    private readonly providers: EvaluationProviderRegistry,
    private readonly subjects: EvaluationSubjectService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly runs: EvaluationRunService,
    private readonly results: EvaluationResultService,
    private readonly findings: EvaluationFindingService,
  ) {}

  async run(input: StartEvaluationRunInput): Promise<EvaluationRunOutcome> {
    const run = await this.runs.startRun(input);
    await this.runs.markRunning(run.id);
    const running = await this.runs.findById(run.id);

    try {
      const subject = toSubjectRef(await this.subjects.getSubject(running.subjectId));
      const version = await this.criteria.getVersion(running.criteriaVersionId);
      const criteriaVersion: EvaluationCriteriaVersionRef = {
        id: version.id,
        kind: version.kind,
        family: version.family,
        version: version.version,
      };

      const evidence = await this.providers.getEvidenceProvider(subject.kind).collect(subject, criteriaVersion);
      const criteria = await this.criteria.listCriteria(criteriaVersion.id);
      const judgment = await this.providers.getJudgmentPort(subject.kind).judge({
        subject,
        criteriaVersion,
        criteria,
        evidence: evidence.items,
      });

      const coverageStats = composeCoverageStats({
        items: evidence.items,
        evaluatedRefs: judgment.evaluatedRefs,
        declaredUnlinked: evidence.declaredUnlinked,
        skippedBuckets: [evidence.skipped, judgment.skipped],
      });

      const result = await this.results.createResult({
        runId: running.id,
        manifest: evidence.items,
        coverageStats,
        verdicts: judgment.verdicts,
        summary: judgment.summary,
      });
      const findings = await this.findings.recordFindings(running, judgment.findings);
      const resolvedFindingCount = await this.findings.resolveAbsentFindings(running);

      await this.runs.markSucceeded(running.id);
      return {
        runId: running.id,
        resultId: result.id,
        findingIds: findings.map((finding) => finding.id),
        resolvedFindingCount,
      };
    } catch (error) {
      await this.runs.markFailed(running.id, error);
      throw error;
    }
  }
}
