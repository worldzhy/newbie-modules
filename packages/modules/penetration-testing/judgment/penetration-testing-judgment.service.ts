import { BadRequestException, Injectable } from "@nestjs/common";
import type { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";
import type {
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
} from "@modules/evaluation/ports/evaluation.contracts";

import {
  isPenetrationTestingKey,
  PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
  PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
  PENETRATION_TESTING_LEVEL_BY_KEY,
} from "../penetration-testing.constants";
import type { PenetrationTestingEngineFinding } from "../ports/penetration-testing.contracts";
import {
  isConfirmedExploitCriterion,
  mapEngineFindingCriterion,
  normalizeSeverity,
  penetrationTestingFingerprint,
  upliftSeverity,
} from "./penetration-testing.mapping";

/**
 * PenetrationTestingJudgmentService — the single deterministic judgment bound to
 * `web-target` (ADR-075 §6).
 *
 * No LLM is involved. Engine findings are mapped through a data table; a
 * confirmed exploit may raise severity by one level (E2); a successful L4
 * playbook produces one `destructive-impact` finding that proves business impact
 * without touching the underlying severity (E3).
 */
@Injectable()
export class PenetrationTestingJudgmentService implements JudgmentPort {
  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const standardKey = input.ruleSetVersion.standardKey;
    if (!isPenetrationTestingKey(standardKey)) {
      throw new BadRequestException(`No penetration-testing judgment for standardKey "${standardKey}".`);
    }
    const allowed = new Set(input.criteria.map((criterion) => criterion.criterionKey));
    if (allowed.size === 0) {
      throw new BadRequestException(`Rule set ${standardKey} has no criteria; refusing to judge.`);
    }

    const findings =
      standardKey === PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING
        ? this.judgeDestructive(input, allowed)
        : this.judgeEngineFindings(input, allowed);

    return {
      verdicts: [],
      findings,
      evaluatedRefs: input.evidence.map((item) => item.id),
      skipped: { total: 0 },
      summary: `${findings.length} finding(s) from ${input.evidence.length} evidence item(s)`,
      metadata: {
        standardKey,
        level: PENETRATION_TESTING_LEVEL_BY_KEY[standardKey],
        mechanism: "deterministic-engine-mapping",
        engineVersions: engineVersions(input),
      },
    };
  }

  private judgeEngineFindings(input: JudgmentInput, allowed: ReadonlySet<string>): EvaluationFindingCandidate[] {
    const findings: EvaluationFindingCandidate[] = [];
    for (const item of input.evidence) {
      const finding = readEngineFinding(item.payload);
      if (!finding) continue;
      const criterionKey = mapEngineFindingCriterion(finding, allowed);
      let severity = normalizeSeverity(finding.severityRaw, finding.cvssScore);
      if (isConfirmedExploitCriterion(criterionKey)) {
        severity = upliftSeverity(severity, 1);
      }
      findings.push({
        criterionKey,
        fingerprint: penetrationTestingFingerprint({
          criterionKey,
          engine: finding.engine,
          ruleId: finding.ruleId,
          location: finding.location,
        }),
        severity,
        title: finding.title,
        detail: finding.detail ?? `${finding.engine} ${finding.ruleId} at ${finding.location}`,
        evidenceRefs: [item.id, ...(finding.evidenceRefs ?? [])],
        metadata: {
          engine: finding.engine,
          engineVersion: finding.engineVersion,
          ruleId: finding.ruleId,
          ruleName: finding.ruleName,
          severityRaw: finding.severityRaw,
          cvssScore: finding.cvssScore,
          location: finding.location,
          tags: finding.tags,
        },
      });
    }
    return findings;
  }

  private judgeDestructive(input: JudgmentInput, allowed: ReadonlySet<string>): EvaluationFindingCandidate[] {
    if (!allowed.has(PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT)) return [];

    const before = findPayload(input, "action:before") as { playbookId?: string; state?: string } | null;
    const after = findPayload(input, "action:after") as { playbookId?: string; state?: string } | null;
    const cleanup = findPayload(input, "action:cleanup") as {
      playbookId?: string;
      testObjectId?: string;
      cleanup?: { succeeded?: boolean };
    } | null;
    if (!before?.playbookId || !after || !cleanup?.cleanup?.succeeded) return [];
    if (before.state === after.state) return [];

    const severity: EvaluationFindingSeverity = "INFO";
    return [
      {
        criterionKey: PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
        fingerprint: penetrationTestingFingerprint({
          criterionKey: PENETRATION_TESTING_CRITERION_DESTRUCTIVE_IMPACT,
          engine: "playbook",
          ruleId: before.playbookId,
          location: cleanup.testObjectId ?? "unknown-test-object",
        }),
        severity,
        title: `Controlled destructive impact confirmed by ${before.playbookId}`,
        detail:
          "The approved playbook changed the disposable test object and cleaned up successfully. " +
          "This proves business impact; it does not raise the underlying finding's severity (E3).",
        evidenceRefs: ["action:before", "action:after", "action:cleanup"],
        metadata: {
          playbookId: before.playbookId,
          testObjectId: cleanup.testObjectId,
          before: before.state,
          after: after.state,
          cleanupSucceeded: true,
        },
      },
    ];
  }
}

function readEngineFinding(payload: unknown): PenetrationTestingEngineFinding | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = (payload as { finding?: unknown }).finding;
  if (!candidate || typeof candidate !== "object") return null;
  const finding = candidate as Partial<PenetrationTestingEngineFinding>;
  if (
    typeof finding.engine !== "string" ||
    typeof finding.ruleId !== "string" ||
    typeof finding.title !== "string" ||
    typeof finding.location !== "string" ||
    typeof finding.severityRaw !== "string"
  ) {
    return null;
  }
  return finding as PenetrationTestingEngineFinding;
}

function findPayload(input: JudgmentInput, id: string): unknown {
  return input.evidence.find((item) => item.id === id)?.payload ?? null;
}

function engineVersions(input: JudgmentInput): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const item of input.evidence) {
    const finding = readEngineFinding(item.payload);
    if (finding) versions[finding.engine] = finding.engineVersion;
  }
  return versions;
}
