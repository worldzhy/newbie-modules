import { Injectable } from "@nestjs/common";
import type { EvaluationFindingCandidate } from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationFindingSeverity } from "../security-evaluation-severity";
import { deriveUrgency } from "../security-evaluation-urgency";
import { cloudConfigFingerprint } from "./security-evaluation-cloud-config.identity";
import {
  SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK,
  SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK,
  rebuildCloudConfigFacts,
} from "./security-evaluation-cloud-config.rulebook";

const MAX_TITLE_LENGTH = 500;
const MAX_DETAIL_LENGTH = 4000;
const SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/**
 * CLOUD_CONFIG judgment — collected account configuration facts against the
 * CIS rulebook (ADR-027). Deterministic by construction: every FAIL of a
 * rulebook entry becomes one finding per non-compliant resource; PASS emits
 * nothing. Collection failures never reach this class as fake facts — the
 * evidence provider already recorded them in the skipped bucket.
 */
@Injectable()
export class SecurityEvaluationCloudConfigJudgment {
  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const facts = rebuildCloudConfigFacts(input.evidence);
    const severityByKey = new Map(
      input.criteria.map((criterion) => [criterion.criterionKey, readSeverity(criterion.metadata)]),
    );

    const findings: EvaluationFindingCandidate[] = [];
    for (const entry of SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK) {
      const severity = severityByKey.get(entry.criterionKey) ?? entry.severity;
      for (const draft of entry.judge(facts)) {
        findings.push({
          criterionKey: entry.criterionKey,
          fingerprint: cloudConfigFingerprint(entry.criterionKey, draft.resourceKey),
          severity,
          title: draft.title.slice(0, MAX_TITLE_LENGTH),
          detail: draft.detail.slice(0, MAX_DETAIL_LENGTH),
          evidenceRefs: draft.evidenceRefs,
          metadata: {
            controlId: entry.controlId,
            resourceKey: draft.resourceKey,
            factType: draft.factType,
            ...(draft.region ? { region: draft.region } : {}),
            urgency: deriveUrgency(severity, "internal"),
          },
        });
      }
    }

    return Promise.resolve({
      verdicts: [],
      findings,
      // Every collected fact fed at least one control, so all of them are evaluated.
      evaluatedRefs: input.evidence.map((item) => item.id),
      summary: `Judged ${SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.length} CIS controls over ${input.evidence.length} configuration facts: ${findings.length} findings.`,
      metadata: {
        benchmark: SECURITY_EVALUATION_CLOUD_CONFIG_BENCHMARK,
        controlsEvaluated: SECURITY_EVALUATION_CLOUD_CONFIG_RULEBOOK.length,
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
