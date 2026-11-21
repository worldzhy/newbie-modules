import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationRunnerService } from "@modules/evaluation/evaluation-runner.service";
import type { StartEvaluationRunInput } from "@modules/evaluation/evaluation-run.service";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

import {
  findPlaybook,
  isPenetrationTestingKey,
  PENETRATION_TESTING_LEVEL_BY_KEY,
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
    private readonly targets: PenetrationTestingTargetService,
    private readonly authorizations: PenetrationTestingAuthorizationService,
    private readonly testObjects: PenetrationTestingTestObjectService,
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
    void this.runner.execute(run).catch((error: unknown) => {
      this.logger.error(
        `Penetration-testing run ${run.id} for subject ${input.subjectId} failed: ${getErrorMessage(error)}`,
      );
    });
    return { runId: run.id };
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
