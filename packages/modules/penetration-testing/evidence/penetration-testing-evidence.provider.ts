import { BadRequestException, Inject, Injectable, InternalServerErrorException, Optional } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvidenceCollection, EvidenceProvider } from "@modules/evaluation/ports/evidence.provider";
import type {
  EvaluationEvidenceItem,
  EvaluationRuleSetVersionRef,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";

import {
  findPlaybook,
  isPenetrationTestingKey,
  PENETRATION_TESTING_BUDGET_BY_KEY,
  PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
  PENETRATION_TESTING_LEVEL_BY_KEY,
} from "../penetration-testing.constants";
import { PenetrationTestingTargetService } from "../assets/penetration-testing-target.service";
import { PenetrationTestingAuthorizationService } from "../authorization/penetration-testing-authorization.service";
import type { PenetrationTestingAuthorizationRecord } from "../authorization/penetration-testing-authorization.service";
import { PenetrationTestingTestObjectService } from "../authorization/penetration-testing-test-object.service";
import { insideMaintenanceWindow } from "../gate/penetration-testing-gate";
import { PenetrationTestingExecutionService } from "./penetration-testing-execution.service";
import { PENETRATION_TESTING_SCANNER_ACCESS, type PenetrationTestingScannerAccess } from "../ports/scanner.access";
import {
  PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS,
  type PenetrationDestructiveActionAccess,
} from "../ports/destructive-action.access";
import type {
  PenetrationTestingDestructiveActionResult,
  PenetrationTestingEngineFinding,
  PenetrationTestingExecutionSnapshot,
  PenetrationTestingScanResult,
  PenetrationTestingTargetDescriptor,
} from "../ports/penetration-testing.contracts";

/**
 * PenetrationTestingEvidenceProvider — collects L1–L3 scan evidence or performs
 * the single L4 playbook action (ADR-075 §5).
 *
 * Fail-closed rules enforced here, after the run gate already admitted the run:
 * - the authorization row is reloaded by id and must still approve this subject,
 *   level and time window;
 * - L3 must match the bound finding and attack class, L4 the approved disposable
 *   test object and its playbook kind;
 * - an unbound host port throws, never returns an empty "clean" collection;
 * - the execution audit row is written immediately after the host call returns,
 *   and its outcome is FAILED when the budget is exceeded.
 */
@Injectable()
export class PenetrationTestingEvidenceProvider implements EvidenceProvider {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: PenetrationTestingTargetService,
    private readonly authorizations: PenetrationTestingAuthorizationService,
    private readonly testObjects: PenetrationTestingTestObjectService,
    private readonly executions: PenetrationTestingExecutionService,
    @Optional()
    @Inject(PENETRATION_TESTING_SCANNER_ACCESS)
    private readonly scanner?: PenetrationTestingScannerAccess | null,
    @Optional()
    @Inject(PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS)
    private readonly destructive?: PenetrationDestructiveActionAccess | null,
  ) {}

  async collect(
    subject: EvaluationSubjectRef,
    ruleSetVersion: EvaluationRuleSetVersionRef,
    runConfig?: Record<string, unknown> | null,
  ): Promise<EvidenceCollection> {
    const standardKey = ruleSetVersion.standardKey;
    if (!isPenetrationTestingKey(standardKey)) {
      throw new BadRequestException(`Unknown penetration-testing standardKey '${standardKey}'.`);
    }
    const level = PENETRATION_TESTING_LEVEL_BY_KEY[standardKey];
    const auditId = readString(runConfig, "auditId");
    const authorizationId = readString(runConfig, "authorizationId");
    if (!auditId) throw new BadRequestException("judgmentConfig.auditId is required.");
    if (!authorizationId) throw new BadRequestException("judgmentConfig.authorizationId is required.");

    const material = await this.targets.material(subject.id);
    if (!material.isActive || material.verificationStatus !== "VERIFIED") {
      throw new BadRequestException(
        `Penetration target ${material.origin} is ${material.verificationStatus} and ${
          material.isActive ? "active" : "inactive"
        }; the gate must have refused this run.`,
      );
    }

    const now = new Date();
    const authorization = await this.authorizations.findById(authorizationId);
    assertAuthorization(authorization, subject.id, level, now);
    if (level === "L3") {
      if (readString(runConfig, "findingId") !== authorization.findingId) {
        throw new BadRequestException("L3 findingId does not match the approved authorization.");
      }
      if (readString(runConfig, "attackClass") !== authorization.attackClass) {
        throw new BadRequestException("L3 attackClass does not match the approved authorization.");
      }
    }
    if (
      level === "L4" &&
      (!authorization.maintenanceWindow || !insideMaintenanceWindow(authorization.maintenanceWindow, now))
    ) {
      throw new BadRequestException("L4 run is outside the approved maintenance window.");
    }

    const target: PenetrationTestingTargetDescriptor = {
      origin: material.origin,
      ports: material.ports,
      pathRoles: material.targetPaths,
      environment: material.environment,
    };
    const budget = PENETRATION_TESTING_BUDGET_BY_KEY[standardKey];
    const startedAt = new Date();
    const runId = await this.resolveRunId(subject.id, ruleSetVersion.id);

    const items: EvaluationEvidenceItem[] = [
      {
        id: "target:material",
        layer: "target",
        source: "penetration-testing",
        summary: `${material.origin} (${material.environment}), declared ports ${
          material.ports.length ? material.ports.join(", ") : "default"
        }`,
        observedAt: now,
        payload: {
          origin: material.origin,
          environment: material.environment,
          ports: material.ports,
          pathRoles: material.targetPaths,
        },
      },
    ];

    if (standardKey === PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING) {
      await this.collectDestructiveAction({
        items,
        runId,
        subjectId: subject.id,
        level: "L4",
        standardKey,
        auditId,
        authorizationId,
        target,
        budget,
        startedAt,
        runConfig,
        now,
      });
    } else {
      await this.collectScan({
        items,
        runId,
        subjectId: subject.id,
        level: level as "L1" | "L2" | "L3",
        standardKey,
        auditId,
        authorizationId,
        target,
        budget,
        startedAt,
        now,
      });
    }

    return { items, declaredUnlinked: { total: 0 }, skipped: { total: 0 } };
  }

  private async resolveRunId(subjectId: string, ruleSetVersionId: string): Promise<string> {
    const run = await this.prisma.evaluationRun.findFirst({
      where: { subjectId, ruleSetVersionId, status: "RUNNING" },
      select: { id: true },
    });
    if (!run) {
      throw new InternalServerErrorException(
        "No RUNNING evaluation run found for this collection; refusing to write an unattributed execution snapshot.",
      );
    }
    return run.id;
  }

  private async collectScan(input: {
    items: EvaluationEvidenceItem[];
    runId: string;
    subjectId: string;
    level: "L1" | "L2" | "L3";
    standardKey: string;
    auditId: string;
    authorizationId: string;
    target: PenetrationTestingTargetDescriptor;
    budget: (typeof PENETRATION_TESTING_BUDGET_BY_KEY)["attack-surface"];
    startedAt: Date;
    now: Date;
  }): Promise<void> {
    const scanner = this.scanner;
    if (!scanner) {
      throw new InternalServerErrorException(
        `${PENETRATION_TESTING_SCANNER_ACCESS} is not bound; L1–L3 requires the host scanner adapter.`,
      );
    }

    let result: PenetrationTestingScanResult;
    try {
      result = await scanner.scan({
        target: input.target,
        level: input.level,
        standardKey: input.standardKey,
        authorizationRef: input.authorizationId,
        budget: input.budget,
      });
    } catch (error) {
      await this.executions.record({
        auditId: input.auditId,
        runId: input.runId,
        subjectId: input.subjectId,
        level: input.level,
        standardKey: input.standardKey,
        authorizationId: input.authorizationId,
        snapshot: unresolvedSnapshot(input.target, input.now),
        startedAt: input.startedAt,
      });
      throw error;
    }

    await this.executions.record({
      auditId: input.auditId,
      runId: input.runId,
      subjectId: input.subjectId,
      level: input.level,
      standardKey: input.standardKey,
      authorizationId: input.authorizationId,
      snapshot: result.execution.snapshot,
      startedAt: input.startedAt,
    });
    await this.executions.finish(input.auditId, {
      outcome: result.execution.outcome,
      requestCount: result.execution.requestCount,
    });

    appendObservations(input.items, result);
    appendFindings(input.items, result.findings);

    if (result.execution.requestCount > input.budget.maxRequests) {
      throw new BadRequestException(
        `Run exceeded its request budget (${result.execution.requestCount} > ${input.budget.maxRequests}).`,
      );
    }
  }

  private async collectDestructiveAction(input: {
    items: EvaluationEvidenceItem[];
    runId: string;
    subjectId: string;
    level: "L4";
    standardKey: string;
    auditId: string;
    authorizationId: string;
    target: PenetrationTestingTargetDescriptor;
    budget: (typeof PENETRATION_TESTING_BUDGET_BY_KEY)["destructive-testing"];
    startedAt: Date;
    runConfig?: Record<string, unknown> | null;
    now: Date;
  }): Promise<void> {
    const destructive = this.destructive;
    if (!destructive) {
      throw new InternalServerErrorException(
        `${PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS} is not bound; L4 requires the host action adapter.`,
      );
    }

    const playbook = findPlaybook(readString(input.runConfig, "playbookId"));
    if (!playbook) throw new BadRequestException("L4 requires a known playbookId.");
    const testObjectId = readString(input.runConfig, "testObjectId");
    if (!testObjectId) throw new BadRequestException("L4 requires a testObjectId.");
    const testObject = await this.testObjects.findApprovedForGate(
      testObjectId,
      input.subjectId,
      playbook.testObjectKind,
      input.now,
    );
    if (!testObject) {
      throw new BadRequestException("L4 test object is missing, unapproved, expired or not disposable.");
    }

    let result: PenetrationTestingDestructiveActionResult;
    try {
      result = await destructive.execute({
        target: input.target,
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        testObject: {
          kind: testObject.kind,
          locator: testObject.locator,
          cleanupLocator: testObject.cleanupLocator,
        },
        authorizationRef: input.authorizationId,
        marker: `nw-${input.auditId}`,
        budget: input.budget,
      });
    } catch (error) {
      await this.executions.record({
        auditId: input.auditId,
        runId: input.runId,
        subjectId: input.subjectId,
        level: input.level,
        standardKey: input.standardKey,
        authorizationId: input.authorizationId,
        snapshot: unresolvedSnapshot(input.target, input.now),
        startedAt: input.startedAt,
      });
      throw error;
    }

    await this.executions.record({
      auditId: input.auditId,
      runId: input.runId,
      subjectId: input.subjectId,
      level: input.level,
      standardKey: input.standardKey,
      authorizationId: input.authorizationId,
      snapshot: result.execution.snapshot,
      startedAt: input.startedAt,
    });
    await this.executions.finish(input.auditId, {
      outcome: result.execution.outcome,
      requestCount: result.execution.requestCount,
    });

    input.items.push(
      {
        id: "action:before",
        layer: "action",
        source: "penetration-testing",
        summary: `State before ${playbook.id}`,
        observedAt: input.now,
        payload: { playbookId: playbook.id, state: result.before },
      },
      {
        id: "action:after",
        layer: "action",
        source: "penetration-testing",
        summary: `State after ${playbook.id}`,
        observedAt: input.now,
        payload: { playbookId: playbook.id, state: result.after },
      },
      {
        id: "action:cleanup",
        layer: "action",
        source: "penetration-testing",
        summary: `Cleanup ${result.cleanup.succeeded ? "succeeded" : "failed"}`,
        observedAt: input.now,
        payload: { playbookId: playbook.id, testObjectId, cleanup: result.cleanup },
      },
    );
    if (result.findings?.length) appendFindings(input.items, result.findings);

    if (result.outcome === "CLEANUP_FAILED" || !result.cleanup.succeeded) {
      throw new BadRequestException(
        `L4 playbook ${playbook.id} could not clean up (${result.cleanup.detail ?? "no detail"}); the target is paused for L4.`,
      );
    }
    if (result.outcome !== "SUCCEEDED") {
      throw new BadRequestException(`L4 playbook ${playbook.id} ended with outcome ${result.outcome}.`);
    }
  }
}

function assertAuthorization(
  authorization: PenetrationTestingAuthorizationRecord | null,
  subjectId: string,
  level: string,
  now: Date,
): asserts authorization is PenetrationTestingAuthorizationRecord {
  if (!authorization || authorization.subjectId !== subjectId || authorization.level !== level) {
    throw new BadRequestException("Approved authorization not found for this subject and level.");
  }
  if (authorization.status !== "APPROVED") {
    throw new BadRequestException(`Authorization is ${authorization.status}, not APPROVED.`);
  }
  if (now.getTime() < authorization.validFrom.getTime() || now.getTime() > authorization.validUntil.getTime()) {
    throw new BadRequestException("Authorization is outside its validity window.");
  }
}

function appendObservations(items: EvaluationEvidenceItem[], result: PenetrationTestingScanResult): void {
  for (const observation of result.observations) {
    items.push({
      id: observation.id,
      layer: "scan",
      source: "penetration-testing",
      summary: observation.summary,
      observedAt: new Date(),
      payload: observation.payload,
    });
  }
}

function appendFindings(items: EvaluationEvidenceItem[], findings: PenetrationTestingEngineFinding[]): void {
  findings.forEach((finding, index) => {
    items.push({
      id: `finding:${index}`,
      layer: "finding",
      source: finding.engine,
      summary: `${finding.engine} ${finding.ruleId}: ${finding.title}`,
      observedAt: new Date(),
      refs: finding.evidenceRefs,
      payload: { finding },
    });
  });
}

function unresolvedSnapshot(
  target: PenetrationTestingTargetDescriptor,
  now: Date,
): PenetrationTestingExecutionSnapshot {
  return {
    host: new URL(target.origin).hostname,
    resolvedIps: [],
    ports: target.ports,
    resolvedAt: now.toISOString(),
    proxyPolicyId: "unresolved",
    engineVersions: {},
  };
}

function readString(config: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = config?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
