import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EvaluationResultService, ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import {
  EvaluationRunService,
  ListEvaluationRunsInput,
  StartEvaluationRunInput,
} from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import { EvaluationSubjectService, ListEvaluationSubjectsInput } from "@modules/evaluation/evaluation-subject.service";

import { WORK_EVALUATION_SUBJECT_KIND } from "./work-evaluation.constants";

export interface StartWorkEvaluationRunInput {
  subjectId: string;
  /** Omit to let the period-pinned criteria version apply. */
  criteriaVersionId?: string;
  requestedByRef?: string;
  /** Opaque per-run config (ADR-023), e.g. modelScope for multi-model runs. */
  config?: Record<string, unknown>;
}

/**
 * WorkEvaluationRunService — thin façade over the evaluation skeleton's run
 * lifecycle and read services (ADR-024, spec §4.4/§4.5).
 *
 * The trigger is fire-and-forget: the skeleton's `runner.run` owns the whole
 * run lifecycle synchronously (open row → judge → close), so this service
 * dispatches and returns before any run row exists. The controller answers
 * 202 immediately; clients discover the run through `listRuns`.
 */
@Injectable()
export class WorkEvaluationRunService {
  private readonly logger = new Logger(WorkEvaluationRunService.name);

  constructor(
    private readonly runner: EvaluationRunnerService,
    private readonly runs: EvaluationRunService,
    private readonly results: EvaluationResultService,
    private readonly subjects: EvaluationSubjectService,
  ) {}

  /**
   * Dispatch a run. Subject existence and kind are validated synchronously so
   * the caller still gets a 400/404 before the 202; everything past this point
   * is observed through the run row.
   */
  async startRun(input: StartWorkEvaluationRunInput): Promise<void> {
    const subject = await this.subjects.getSubject(input.subjectId);
    if (subject.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new BadRequestException(
        `Evaluation subject ${input.subjectId} has kind "${subject.kind}", not "${WORK_EVALUATION_SUBJECT_KIND}"`,
      );
    }
    const built: StartEvaluationRunInput = {
      subjectId: input.subjectId,
      criteriaVersionId: input.criteriaVersionId,
      requestedByRef: input.requestedByRef,
      config: input.config,
    };
    // The runner records every terminal state on the run row itself; this
    // catch only keeps a rejected fire-and-forget promise from surfacing as
    // an unhandled rejection.
    void this.runner.run(built).catch((error: unknown) => {
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

  /** Subject listing is pinned to this feature's kind. */
  listSubjects(query: Omit<ListEvaluationSubjectsInput, "kind">) {
    return this.subjects.listSubjects({ ...query, kind: WORK_EVALUATION_SUBJECT_KIND });
  }
}
