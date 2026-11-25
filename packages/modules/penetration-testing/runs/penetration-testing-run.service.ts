import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EvaluationRun } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AlertCenterService } from "@modules/alert-center/alert-center.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationFindingService } from "@modules/evaluation/evaluation-finding.service";
import type { ListEvaluationFindingsInput } from "@modules/evaluation/evaluation-finding.service";
import { EvaluationResultService } from "@modules/evaluation/evaluation-result.service";
import type { ListEvaluationResultsInput } from "@modules/evaluation/evaluation-result.service";
import { EvaluationRunService } from "@modules/evaluation/evaluation-run.service";
import type { ListEvaluationRunsInput, StartEvaluationRunInput } from "@modules/evaluation/evaluation-run.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

import {
  findPlaybook,
  isPenetrationTestingKey,
  PENETRATION_TESTING_LEVEL_BY_KEY,
  PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET,
  type PenetrationTestingLevel,
} from "../penetration-testing.constants";
import { PenetrationTestingTargetService } from "../assets/penetration-testing-target.service";
import { PenetrationTestingAuthorizationService } from "../authorization/penetration-testing-authorization.service";
import { PenetrationTestingTestObjectService } from "../authorization/penetration-testing-test-object.service";
import { evaluatePenetrationTestingGate } from "../gate/penetration-testing-gate";

export interface StartPenetrationTestingRunInput extends Omit<StartEvaluationRunInput, "subjectId"> {
  subjectId: string;
}

/**
 * PenetrationTestingRunService — the only entry point to a run (ADR-075 §4).
 *
 * Every caller (manual POST /runs, the weekly job, a future dispatcher) passes
 * through here. The gate reloads the target, the authorization and the L4 test
 * object from the database; `judgmentConfig` is treated as intent only. Admission
 * stays on the request path (400/404/409), execution is fire-and-forget.
 */
@Injectable()
export class PenetrationTestingRunService {
  private readonly logger = new Logger(PenetrationTestingRunService.name);

  constructor(
    private readonly runner: EvaluationRunnerService,
    private readonly prisma: PrismaService,
    private readonly alerts: AlertCenterService,
    private readonly targets: PenetrationTestingTargetService,
    private readonly authorizations: PenetrationTestingAuthorizationService,
    private readonly testObjects: PenetrationTestingTestObjectService,
    private readonly runs: EvaluationRunService,
    private readonly criteria: EvaluationCriteriaService,
    private readonly results: EvaluationResultService,
    private readonly findings: EvaluationFindingService,
  ) {}

  async startRun(input: StartPenetrationTestingRunInput): Promise<{ runId: string }> {
    const runConfig: Record<string, unknown> = { ...(input.judgmentConfig ?? {}) };
    const standardKey = runConfig.standardKey;
    if (!isPenetrationTestingKey(standardKey)) {
      throw new BadRequestException(
        "judgmentConfig.standardKey must be one of attack-surface, vulnerability-scan, exploit-verification, destructive-testing.",
      );
    }
    const level = PENETRATION_TESTING_LEVEL_BY_KEY[standardKey];
    const auditId = typeof runConfig.auditId === "string" && runConfig.auditId ? runConfig.auditId : randomUUID();
    runConfig.auditId = auditId;

    const { row: targetRow } = await this.targets.getTarget(input.subjectId);
    const now = new Date();

    const authorization = await this.resolveAuthorization(input.subjectId, level, runConfig);
    const playbookId = readString(runConfig, "playbookId");
    const playbook = findPlaybook(playbookId);
    const testObjectId = readString(runConfig, "testObjectId");
    const testObject =
      level === "L4" && playbook && testObjectId
        ? await this.testObjects.findApprovedForGate(testObjectId, input.subjectId, playbook.testObjectKind, now)
        : null;

    const decision = evaluatePenetrationTestingGate({
      subjectId: input.subjectId,
      standardKey,
      runConfig,
      target: {
        environment: targetRow.environment,
        verificationStatus: targetRow.verificationStatus,
        isActive: targetRow.isActive,
      },
      authorization,
      testObject,
      activeStandardKeys: await this.activeStandardKeys(input.subjectId),
      lastL4CleanupFailedAt: level === "L4" ? await this.lastL4CleanupFailedAt(input.subjectId) : null,
      now,
    });
    if (!decision.ok) {
      const message = `Penetration-testing run refused: ${decision.reason}${
        decision.detail ? ` (${decision.detail})` : ""
      }`;
      if (decision.reason === "ACTIVE_RUN_CONFLICT") throw new ConflictException(message);
      throw new BadRequestException(message);
    }

    const run = await this.runner.open({ ...input, judgmentConfig: runConfig });
    const runAlertKey = `${input.subjectId}:${standardKey}`;
    // A new run entering RUNNING resolves any earlier run-failed alert for the
    // same subject+key — the retry signals the subject is still being monitored.
    void this.alerts
      .resolve({ source: "penetration-testing", alertKey: runAlertKey, scopeId: input.subjectId })
      .catch(() => {});
    void this.runner.execute(run).catch((error: unknown) => {
      const errorText = getErrorMessage(error);
      this.logger.error(`Penetration-testing run ${run.id} for subject ${input.subjectId} failed: ${errorText}`);
      // Raise run-failed alert; it auto-advances on repeated failures and
      // resolves on the next successful retry above.
      void this.alerts
        .raise({
          source: "penetration-testing",
          alertKey: runAlertKey,
          scopeId: input.subjectId,
          severity: "medium",
          labels: { standardKey, level },
          data: { runId: run.id, error: errorText.slice(0, 200) },
        })
        .catch((alertError: unknown) => {
          this.logger.error(`Failed to raise penetration-testing run-failed alert: ${getErrorMessage(alertError)}`);
        });
    });
    return { runId: run.id };
  }

  /**
   * Run history, always scoped to this feature's subject kind. The skeleton
   * stores only `ruleSetVersionId`, so the key and version label are joined in
   * the same way security-evaluation does.
   */
  async listRuns(query: Omit<ListEvaluationRunsInput, "kind">) {
    const page = await this.runs.listRuns({ ...query, kind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET });
    const records = page.records as EvaluationRun[];
    const versionIds = [...new Set(records.map((run) => run.ruleSetVersionId))];
    const versions = new Map(
      (await Promise.all(versionIds.map((id) => this.criteria.getVersion(id)))).map((version) => [version.id, version]),
    );
    return {
      ...page,
      records: records.map((run) => {
        const version = versions.get(run.ruleSetVersionId);
        return { ...run, standardKey: version?.standardKey ?? "", ruleSetVersion: version?.version ?? "" };
      }),
    };
  }

  /**
   * One run with its criteria labels joined in, matching the list rows. The
   * skeleton stores only `ruleSetVersionId`, so returning the raw row would
   * leave `standardKey`/`ruleSetVersion` undefined for a detail read.
   */
  async getRun(runId: string) {
    const row = await this.runs.findById(runId, PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET);
    const version = await this.criteria.getVersion(row.ruleSetVersionId);
    return { ...row, standardKey: version?.standardKey ?? "", ruleSetVersion: version?.version ?? "" };
  }

  listResults(query: ListEvaluationResultsInput) {
    return this.results.listResults({ ...query, kind: PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET });
  }

  listFindings(query: ListEvaluationFindingsInput) {
    return this.findings.listFindings(query);
  }

  /**
   * Stop a QUEUED or RUNNING run (ADR-075 §4). Transitions it to CANCELLED;
   * the runner's next assertActive fencing check throws and stops further
   * writes. A terminal run (SUCCEEDED/FAILED/CANCELLED) is a no-op.
   */
  async stopRun(runId: string, operatorId: string, reason?: string): Promise<{ runId: string; status: string }> {
    const run = await this.runs.findById(runId, PENETRATION_TESTING_SUBJECT_KIND_WEB_TARGET);
    if (!run) return { runId, status: "NOT_FOUND" };
    const terminal = ["SUCCEEDED", "FAILED", "CANCELLED"];
    if (terminal.includes(run.status)) {
      return { runId, status: run.status };
    }
    const cancelReason = reason ?? `Cancelled by ${operatorId}`;
    await this.runs.markCancelled(runId, cancelReason);
    const auditId =
      typeof run.judgmentConfig === "object" && run.judgmentConfig
        ? String((run.judgmentConfig as Record<string, unknown>).auditId ?? "")
        : "";
    if (auditId) {
      await this.prisma.penetrationTestingExecution.updateMany({
        where: { auditId },
        data: { outcome: "KILLED", killedAt: new Date(), killReason: cancelReason, finishedAt: new Date() },
      });
    }
    return { runId, status: "CANCELLED" };
  }

  private async resolveAuthorization(
    subjectId: string,
    level: PenetrationTestingLevel,
    runConfig: Record<string, unknown>,
  ) {
    const authorizationId = readString(runConfig, "authorizationId");
    if (authorizationId) return this.authorizations.findById(authorizationId);
    return this.authorizations.findApproved(subjectId, level);
  }

  /**
   * ADR-050 §6: a failed cleanup pauses L4 for the subject until a newer
   * approval. The newest L4 execution is the only authority — a later success
   * or a re-approval moves past the wall.
   */
  private async lastL4CleanupFailedAt(subjectId: string): Promise<Date | null> {
    const latest = await this.prisma.penetrationTestingExecution.findFirst({
      where: { subjectId, level: "L4" },
      orderBy: { startedAt: "desc" },
      select: { outcome: true, startedAt: true },
    });
    return latest?.outcome === "CLEANUP_FAILED" ? latest.startedAt : null;
  }

  /** Standard keys of the subject's QUEUED/RUNNING runs, for cross-level exclusion. */
  private async activeStandardKeys(subjectId: string): Promise<string[]> {
    const active = await this.prisma.evaluationRun.findMany({
      where: { subjectId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { ruleSetVersionId: true },
    });
    if (active.length === 0) return [];
    const versions = await this.prisma.evaluationRuleSetVersion.findMany({
      where: { id: { in: active.map((run) => run.ruleSetVersionId) } },
      select: { standardKey: true },
    });
    return [...new Set(versions.map((version) => version.standardKey))];
  }
}

function readString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
