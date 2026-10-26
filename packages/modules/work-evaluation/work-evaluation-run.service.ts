import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WorkEvaluationPeriodStatus, WorkEvaluationPeriodType } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationResultService, ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import {
  EvaluationRunService,
  ListEvaluationRunsInput,
  StartEvaluationRunInput,
} from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import { EvaluationSubjectService, ListEvaluationSubjectsInput } from "@modules/evaluation/evaluation-subject.service";

import { WORK_EVALUATION_SUBJECT_KIND, WORK_EVALUATION_SUBJECT_SCOPE_TYPE } from "./work-evaluation.constants";
import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";

export interface StartWorkEvaluationRunInput {
  /** The member to evaluate; the subject row is registered lazily (ADR-026 D2). */
  evaluateeUserId: string;
  /** COLLECTION period that has started; pins the criteria version and evidence window. */
  periodId: string;
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
    private readonly periods: WorkEvaluationPeriodService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Dispatch a run against a member and a period. Period eligibility and the
   * evaluatee's existence are validated synchronously so the caller still gets
   * a 400/404 before the 202; everything past this point is observed through
   * the run row.
   */
  async startRun(input: StartWorkEvaluationRunInput): Promise<void> {
    const period = await this.periods.getPeriodById(input.periodId);
    if (period.type !== WorkEvaluationPeriodType.COLLECTION) {
      throw new BadRequestException(
        `Runs can only be dispatched against COLLECTION periods; period ${period.id} is ${period.type}`,
      );
    }
    if (period.status === WorkEvaluationPeriodStatus.UPCOMING) {
      throw new BadRequestException(
        `Runs can only be dispatched against a period that has started; period ${period.id} is UPCOMING`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.evaluateeUserId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException(`User ${input.evaluateeUserId} not found`);

    const subject = await this.subjects.ensureSubject({
      kind: WORK_EVALUATION_SUBJECT_KIND,
      scopeType: WORK_EVALUATION_SUBJECT_SCOPE_TYPE,
      scopeId: user.id,
      subjectKey: user.id,
      displayName: user.name ?? user.email ?? user.id,
    });

    const built: StartEvaluationRunInput = {
      subjectId: subject.id,
      requestedByRef: input.requestedByRef,
      config: { ...input.config, periodId: period.id },
    };
    // The runner records every terminal state on the run row itself; this
    // catch only keeps a rejected fire-and-forget promise from surfacing as
    // an unhandled rejection.
    void this.runner.run(built).catch((error: unknown) => {
      this.logger.error(
        `Evaluation run for subject ${subject.id} failed: ${error instanceof Error ? error.message : String(error)}`,
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
