import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { EvaluationRun } from "@generated/prisma/client";

import { EvaluationCriteriaService } from "./evaluation-criteria.service";
import {
  EVALUATION_RUN_FAILED_EVENT,
  EVALUATION_RUN_SUCCEEDED_EVENT,
  EvaluationRunEventIdentity,
  EvaluationRunFailedEvent,
  EvaluationRunSucceededEvent,
} from "./evaluation.events";
import { EvaluationFindingService } from "./evaluation-finding.service";
import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationResultService } from "./evaluation-result.service";
import {
  DEFAULT_EVALUATION_RUN_OPTIONS,
  EvaluationRunOptions,
  EvaluationRunService,
  evaluationRunOptionsToken,
  formatRunError,
  StartEvaluationRunInput,
} from "./evaluation-run.service";
import { EvaluationSubjectService, toSubjectRef } from "./evaluation-subject.service";
import { EvaluationCriteriaVersionRef } from "./ports/evaluation.contracts";
import { EvaluationRunFinishedEvent } from "./ports/observer.port";
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
 *
 * Liveness is two-sided. A heartbeat keeps the row fresh while the judgment
 * works, so the stale-run reaper never fails a living run; and a fencing check
 * before every write stops this execution if the row was nevertheless closed
 * or reaped — writing on behalf of a dead run would corrupt the lifecycle.
 */
@Injectable()
export class EvaluationRunnerService {
  private readonly logger = new Logger(EvaluationRunnerService.name);

  constructor(
    private readonly providers: EvaluationProviderRegistry,
    private readonly subjects: EvaluationSubjectService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly runs: EvaluationRunService,
    private readonly results: EvaluationResultService,
    private readonly findings: EvaluationFindingService,
    private readonly events: EventEmitter2,
    @Optional()
    @Inject(evaluationRunOptionsToken)
    private readonly options: EvaluationRunOptions = {},
  ) {}

  /**
   * Open the run synchronously and return the RUNNING row.
   *
   * Admission is the part that belongs to the request path: subject existence,
   * criteria-version applicability and the one-active-run-per-subject-version
   * conflict are all decided by the database here, so a caller dispatching a
   * fire-and-forget run can still answer 400/404/409 before accepting it.
   */
  async open(input: StartEvaluationRunInput): Promise<EvaluationRun> {
    const run = await this.runs.startRun(input);
    await this.runs.markRunning(run.id);
    return this.runs.findById(run.id);
  }

  /** Open then execute in one call — for callers that can await the whole run. */
  async run(input: StartEvaluationRunInput): Promise<EvaluationRunOutcome> {
    return this.execute(await this.open(input));
  }

  /** Execute an already-open run. Errors are the execution's own, never admission's. */
  async execute(running: EvaluationRun): Promise<EvaluationRunOutcome> {
    const startedAt = running.startedAt;
    let identity: EvaluationRunEventIdentity | undefined;

    const heartbeat = setInterval(() => {
      this.runs.touch(running.id).catch((error: unknown) => {
        this.logger.warn(`Heartbeat for evaluation run ${running.id} failed: ${describe(error)}`);
      });
    }, this.options.heartbeatIntervalMs ?? DEFAULT_EVALUATION_RUN_OPTIONS.heartbeatIntervalMs);
    heartbeat.unref();

    try {
      const subject = toSubjectRef(await this.subjects.getSubject(running.subjectId));
      const version = await this.criteria.getVersion(running.criteriaVersionId);
      const criteriaVersion: EvaluationCriteriaVersionRef = {
        id: version.id,
        kind: version.kind,
        evaluationKey: version.evaluationKey,
        version: version.version,
      };
      identity = {
        runId: running.id,
        subjectId: running.subjectId,
        subjectKind: subject.kind,
        criteriaVersionId: running.criteriaVersionId,
        evaluationKey: version.evaluationKey,
      };

      const runConfig = (running.config as Record<string, unknown> | null) ?? null;
      const evidence = await this.providers
        .getEvidenceProvider(subject.kind)
        .collect(subject, criteriaVersion, runConfig);
      const criteria = await this.criteria.listCriteria(criteriaVersion.id);
      const judgment = await this.providers.getJudgmentPort(subject.kind).judge({
        subject,
        criteriaVersion,
        criteria,
        evidence: evidence.items,
        runConfig,
      });

      const coverage = composeCoverageStats({
        items: evidence.items,
        evaluatedRefs: judgment.evaluatedRefs,
        declaredUnlinked: evidence.declaredUnlinked,
        skippedBuckets: [evidence.skipped, judgment.skipped],
      });
      if (coverage.problems.length > 0) throw new BadRequestException(coverage.problems);

      await this.runs.assertActive(running.id, startedAt);
      const result = await this.results.createResult({
        runId: running.id,
        manifest: evidence.items,
        coverageStats: coverage.stats,
        verdicts: judgment.verdicts,
        summary: judgment.summary,
        metadata: judgment.metadata,
      });

      await this.runs.assertActive(running.id, startedAt);
      const findings = await this.findings.recordFindings(
        running,
        judgment.findings,
        evidence.items.map((item) => item.id),
      );

      await this.runs.assertActive(running.id, startedAt);
      const resolvedFindingCount = await this.findings.resolveAbsentFindings(running);

      await this.runs.assertActive(running.id, startedAt);
      await this.runs.markSucceeded(running.id);
      await this.publishRunTerminal(running, identity, { status: "SUCCEEDED" });
      await this.notifyRunFinished({
        runId: running.id,
        subjectId: running.subjectId,
        criteriaVersionId: running.criteriaVersionId,
        status: "SUCCEEDED",
      });
      return {
        runId: running.id,
        resultId: result.id,
        findingIds: findings.map((finding) => finding.id),
        resolvedFindingCount,
      };
    } catch (error) {
      // The row may already be terminal (reaped as stale underneath us):
      // failing it again conflicts, and that secondary failure must not mask
      // the original error.
      await this.runs.markFailed(running.id, error).catch(() => undefined);
      await this.publishRunTerminal(running, identity, { status: "FAILED", error: formatRunError(error) });
      await this.notifyRunFinished({
        runId: running.id,
        subjectId: running.subjectId,
        criteriaVersionId: running.criteriaVersionId,
        status: "FAILED",
        error: describe(error),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** The observer is optional auxiliary wiring; its failure never fails a run. */
  private async notifyRunFinished(event: EvaluationRunFinishedEvent): Promise<void> {
    const observer = this.providers.getObserver();
    if (!observer?.onRunFinished) return;
    try {
      await observer.onRunFinished(event);
    } catch (error) {
      this.logger.warn(`EvaluationObserver.onRunFinished failed for run ${event.runId}: ${describe(error)}`);
    }
  }

  /**
   * Publish the run's terminal event (ADR-032). This is the only emit site of
   * `evaluation.run-*`; features must not emit their own. The row is already
   * terminal when this runs, and a publish failure is logged, never promoted —
   * an event channel problem must not change what the run concluded.
   */
  private async publishRunTerminal(
    running: EvaluationRun,
    identity: EvaluationRunEventIdentity | undefined,
    outcome: { status: "SUCCEEDED" } | { status: "FAILED"; error: string },
  ): Promise<void> {
    try {
      const resolved = identity ?? (await this.resolveRunIdentity(running));
      if (outcome.status === "FAILED") {
        this.events.emit(EVALUATION_RUN_FAILED_EVENT, {
          ...resolved,
          status: "FAILED",
          error: outcome.error,
        } satisfies EvaluationRunFailedEvent);
        return;
      }
      this.events.emit(EVALUATION_RUN_SUCCEEDED_EVENT, {
        ...resolved,
        status: "SUCCEEDED",
      } satisfies EvaluationRunSucceededEvent);
    } catch (error) {
      this.logger.warn(`Terminal event for evaluation run ${running.id} could not be published: ${describe(error)}`);
    }
  }

  /**
   * Best-effort identity for a run that failed before subject and version were
   * read. Both rows were verified at admission and the run row references them,
   * so this only fails in a pathological deleted-row state — in which case the
   * failure is logged and the event skipped, never emitted with blanks.
   */
  private async resolveRunIdentity(running: EvaluationRun): Promise<EvaluationRunEventIdentity> {
    const subject = await this.subjects.getSubject(running.subjectId);
    const version = await this.criteria.getVersion(running.criteriaVersionId);
    return {
      runId: running.id,
      subjectId: running.subjectId,
      subjectKind: subject.kind,
      criteriaVersionId: running.criteriaVersionId,
      evaluationKey: version.evaluationKey,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
