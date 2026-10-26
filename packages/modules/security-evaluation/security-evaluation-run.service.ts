import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EvaluationResultService, ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import { EvaluationRunService, ListEvaluationRunsInput } from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import { EvaluationSubjectService } from "@modules/evaluation/evaluation-subject.service";
import type { StartEvaluationRunInput } from "@modules/evaluation/evaluation-run.service";

import { SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY } from "./security-evaluation.constants";

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
    private readonly subjects: EvaluationSubjectService,
  ) {}

  async startRun(input: StartSecurityEvaluationRunInput): Promise<void> {
    const subject = await this.subjects.getSubject(input.subjectId);
    // Slice 1 ships the DEPENDENCY judgment only. Rejecting the other kind here
    // keeps the failure synchronous instead of answering 202 for a run that can
    // never be opened; the guard goes away when CLOUD_CONFIG lands.
    if (subject.kind !== SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY) {
      throw new BadRequestException(
        `Evaluation subject ${input.subjectId} has kind "${subject.kind}"; this build only judges kind "${SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY}".`,
      );
    }
    const run = await this.runner.open(input);
    void this.runner.execute(run).catch((error: unknown) => {
      this.logger.error(
        `Evaluation run ${run.id} for subject ${input.subjectId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  listRuns(query: ListEvaluationRunsInput) {
    return this.runs.listRuns(query);
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
