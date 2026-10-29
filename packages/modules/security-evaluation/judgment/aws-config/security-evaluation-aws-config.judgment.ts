import { Injectable } from "@nestjs/common";
import type { EvaluationFindingCandidate } from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationFindingSeverity } from "../security-evaluation-severity";
import { deriveUrgency } from "../security-evaluation-urgency";
import { SECURITY_EVALUATION_KEY_AWS_CIS_1_5 } from "../../security-evaluation.constants";
import { awsConfigFingerprint } from "./security-evaluation-aws-config.identity";
import {
  SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
  SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK,
  rebuildAwsConfigKnowledge,
} from "./security-evaluation-aws-config.rulebook";

const MAX_TITLE_LENGTH = 500;
const MAX_DETAIL_LENGTH = 4000;
const SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/**
 * aws-config judgment — collected account configuration items against the
 * rulebook (ADR-027, ADR-037). One mechanism serves both AWS evaluation keys
 * (`aws-cis-1.5` and `aws-custom`); the run's criteria evaluationKey selects
 * which entries apply. Deterministic by construction: every FAIL of a
 * rulebook entry becomes one finding per non-compliant resource; PASS emits
 * nothing. Collection failures never reach this class as fake items — the
 * evidence provider already recorded them in the skipped bucket.
 */
@Injectable()
export class SecurityEvaluationAwsConfigJudgment {
  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const items = rebuildAwsConfigKnowledge(input.evidence);
    const evaluationKey = input.ruleSetVersion.evaluationKey;

    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter((entry) => entry.evaluationKey === evaluationKey);

    const severityByKey = new Map(
      input.criteria.map((criterion) => [criterion.criterionKey, readSeverity(criterion.metadata)]),
    );

    const findings: EvaluationFindingCandidate[] = [];

    // A knowledge item counts as evaluated if any rule in this evaluation key
    // declares its type as required — whether or not it produced a finding (ADR-037 D7).
    const requiredKnowledgeTypes = new Set(entries.flatMap((entry) => [...entry.requiredKnowledgeTypes]));

    for (const entry of entries) {
      const criterionSeverity = severityByKey.get(entry.criterionKey) ?? entry.severity;
      for (const draft of entry.judge(items)) {
        const severity = draft.severity ?? criterionSeverity;
        findings.push({
          criterionKey: entry.criterionKey,
          fingerprint: awsConfigFingerprint(entry.criterionKey, draft.resourceKey),
          severity,
          title: draft.title.slice(0, MAX_TITLE_LENGTH),
          detail: draft.detail.slice(0, MAX_DETAIL_LENGTH),
          evidenceRefs: draft.evidenceRefs,
          metadata: {
            resourceKey: draft.resourceKey,
            type: draft.type,
            ...(entry.controlId ? { controlId: entry.controlId } : {}),
            ...(draft.region ? { region: draft.region } : {}),
            ...(draft.attachments ? { attachments: draft.attachments } : {}),
            urgency: deriveUrgency(severity, "internal"),
          },
        });
      }
    }

    // Knowledge items this evaluation key's rules did not need stay out of evaluatedRefs
    // (ADR-037 D7); the skeleton buckets them as coverageStats.unconsumed.
    const evaluatedRefs = input.evidence
      .filter((item) => requiredKnowledgeTypes.has(String(item.payload?.type)))
      .map((item) => item.id);

    const isCis = evaluationKey === SECURITY_EVALUATION_KEY_AWS_CIS_1_5;
    return Promise.resolve({
      verdicts: [],
      findings,
      evaluatedRefs,
      summary: `Judged ${entries.length} ${isCis ? "CIS controls" : "custom rules"} over ${input.evidence.length} configuration items: ${findings.length} findings.`,
      metadata: {
        ...(isCis ? { benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK } : {}),
        evaluationKey,
        rulesEvaluated: entries.length,
        findingsEmitted: findings.length,
      },
    });
  }
}

function readSeverity(metadata: Record<string, unknown> | null | undefined): SecurityEvaluationFindingSeverity | null {
  const severity = metadata?.severity;
  return typeof severity === "string" && SEVERITIES.has(severity)
    ? (severity as SecurityEvaluationFindingSeverity)
    : null;
}
