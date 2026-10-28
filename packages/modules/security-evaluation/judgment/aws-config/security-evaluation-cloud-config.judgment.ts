import { Injectable } from "@nestjs/common";
import type { EvaluationFindingCandidate } from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationFindingSeverity } from "../security-evaluation-severity";
import { deriveUrgency } from "../security-evaluation-urgency";
import { cloudConfigFingerprint } from "./security-evaluation-cloud-config.identity";
import {
  SECURITY_EVALUATION_AWS_CIS_BENCHMARK,
  SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK,
  rebuildCloudConfigFacts,
} from "./security-evaluation-cloud-config.rulebook";

const MAX_TITLE_LENGTH = 500;
const MAX_DETAIL_LENGTH = 4000;
const SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/**
 * CLOUD_CONFIG judgment — collected account configuration facts against the
 * rulebook (ADR-027, ADR-037). One mechanism serves both AWS evaluation keys
 * (`aws-cis-1.5` and `aws-custom`); the run's criteria evaluationKey selects
 * which entries apply. Deterministic by construction: every FAIL of a
 * rulebook entry becomes one finding per non-compliant resource; PASS emits
 * nothing. Collection failures never reach this class as fake facts — the
 * evidence provider already recorded them in the skipped bucket.
 */
@Injectable()
export class SecurityEvaluationCloudConfigJudgment {
  judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    const facts = rebuildCloudConfigFacts(input.evidence);
    const evaluationKey = input.criteriaVersion.evaluationKey;

    const entries = SECURITY_EVALUATION_AWS_CONFIG_RULEBOOK.filter((entry) => entry.evaluationKey === evaluationKey);

    const severityByKey = new Map(
      input.criteria.map((criterion) => [criterion.criterionKey, readSeverity(criterion.metadata)]),
    );

    const findings: EvaluationFindingCandidate[] = [];

    // A fact counts as evaluated if any rule in this evaluation key declares it as a
    // required fact type — whether or not it produced a finding (ADR-037 D7).
    const requiredFactTypes = new Set(entries.flatMap((entry) => [...entry.requiredFactTypes]));

    for (const entry of entries) {
      const criterionSeverity = severityByKey.get(entry.criterionKey) ?? entry.severity;
      for (const draft of entry.judge(facts)) {
        const severity = draft.severity ?? criterionSeverity;
        findings.push({
          criterionKey: entry.criterionKey,
          fingerprint: cloudConfigFingerprint(entry.criterionKey, draft.resourceKey),
          severity,
          title: draft.title.slice(0, MAX_TITLE_LENGTH),
          detail: draft.detail.slice(0, MAX_DETAIL_LENGTH),
          evidenceRefs: draft.evidenceRefs,
          metadata: {
            resourceKey: draft.resourceKey,
            factType: draft.factType,
            ...(entry.controlId ? { controlId: entry.controlId } : {}),
            ...(draft.region ? { region: draft.region } : {}),
            ...(draft.attachments ? { attachments: draft.attachments } : {}),
            urgency: deriveUrgency(severity, "internal"),
          },
        });
      }
    }

    const evaluatedRefs = input.evidence
      .filter((item) => requiredFactTypes.has(String(item.payload?.factType)))
      .map((item) => item.id);
    const unconsumedRefs = input.evidence
      .filter((item) => !requiredFactTypes.has(String(item.payload?.factType)))
      .map((item) => item.id);

    const isCis = evaluationKey === "aws-cis-1.5";
    return Promise.resolve({
      verdicts: [],
      findings,
      evaluatedRefs,
      summary: `Judged ${entries.length} ${isCis ? "CIS controls" : "custom rules"} over ${input.evidence.length} configuration facts: ${findings.length} findings.`,
      metadata: {
        ...(isCis ? { benchmark: SECURITY_EVALUATION_AWS_CIS_BENCHMARK } : {}),
        evaluationKey,
        rulesEvaluated: entries.length,
        findingsEmitted: findings.length,
        // Facts this family's rules did not need (ADR-037 D7). Kept out of
        // evaluatedRefs so coverage is not inflated; surfaced here for reports.
        ...(unconsumedRefs.length > 0 ? { unconsumed: { total: unconsumedRefs.length, items: unconsumedRefs } } : {}),
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
