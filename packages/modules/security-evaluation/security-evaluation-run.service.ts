import { Injectable, Logger } from "@nestjs/common";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationResultService, ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import { EvaluationRunService, ListEvaluationRunsInput } from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import type { StartEvaluationRunInput } from "@modules/evaluation/evaluation-run.service";

export interface StartSecurityEvaluationRunInput extends Omit<StartEvaluationRunInput, "subjectId"> {
  subjectId: string;
}

/**
 * SecurityEvaluationRunService — thin façade over the skeleton's run lifecycle.
 *
 * Dispatch is two-phase. Admission (the skeleton opening the run row) stays on
 * the request path, so a missing subject, a draft criteria version or an active
 * run of the same subject and version still answers 400/404/409 instead of a
 * 202 for a run that will never execute. Execution is fire-and-forget: the
 * caller discovers the outcome by polling `GET /security-evaluation/runs`.
 */
@Injectable()
export class SecurityEvaluationRunService {
  private readonly logger = new Logger(SecurityEvaluationRunService.name);

  constructor(
    private readonly runner: EvaluationRunnerService,
    private readonly runs: EvaluationRunService,
    private readonly results: EvaluationResultService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  async startRun(input: StartSecurityEvaluationRunInput): Promise<void> {
    // Admission (subject existence, published version, concurrency) is decided
    // by the skeleton inside `open`, on the request path; kind support is
    // decided by the port bindings, not by a guard here.
    const run = await this.runner.open(input);
    void this.runner.execute(run).catch((error: unknown) => {
      this.logger.error(
        `Evaluation run ${run.id} for subject ${input.subjectId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /**
   * Runs decorated with their criteria family labels: the skeleton row only
   * carries criteriaVersionId, while the API consumer displays the
   * evaluationKey and version of what the run was judged against.
   */
  async listRuns(query: ListEvaluationRunsInput) {
    const page = await this.runs.listRuns(query);
    const versionIds = [...new Set(page.records.map((run) => run.criteriaVersionId))];
    const versions = new Map(
      (await Promise.all(versionIds.map((id) => this.criteria.getVersion(id)))).map((version) => [version.id, version]),
    );
    return {
      ...page,
      records: page.records.map((run) => {
        const version = versions.get(run.criteriaVersionId);
        return { ...run, evaluationKey: version?.evaluationKey ?? "", criteriaVersion: version?.version ?? "" };
      }),
    };
  }

  getRun(id: string) {
    return this.runs.findById(id);
  }

  listResults(query: ListEvaluationResultsInput) {
    return this.results.listResults(query);
  }

  getResult(id: string) {
    return this.results.getResult(id);
  }

  getResultForRun(runId: string) {
    return this.results.getResultForRun(runId);
  }
}
