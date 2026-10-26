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
 * The trigger is fire-and-forget, like the first feature: the skeleton's
 * runner owns the lifecycle synchronously, so this dispatches and returns
 * before any run row exists. Subject existence and kind are validated up front
 * so the caller still gets a 400/404 before the 202.
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
    void this.runner.run(input).catch((error: unknown) => {
      this.logger.error(
        `Evaluation run for subject ${input.subjectId} failed: ${error instanceof Error ? error.message : String(error)}`,
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
