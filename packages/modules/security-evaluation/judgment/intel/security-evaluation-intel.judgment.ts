import { Injectable } from "@nestjs/common";
import type {
  EvaluationCoverageBucket,
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_KEY_THREAT_INTEL,
  SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
} from "../../security-evaluation.constants";
import { SecurityEvaluationKnowledgeSeverity } from "../../knowledge/security-evaluation-knowledge.constants";
import {
  SECURITY_EVALUATION_MECHANISM_NAME_INTEL,
  type SecurityEvaluationJudgmentMechanism,
} from "../security-evaluation-mechanism";
import {
  SecurityEvaluationIntelMatchService,
  type IntelEvidenceCandidate,
} from "./security-evaluation-intel-match.service";
import type { SecurityEvaluationScopeEntity } from "./security-evaluation-scope-entities.port";

const SEVERITY_TO_FINDING: Record<SecurityEvaluationKnowledgeSeverity, EvaluationFindingSeverity> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

/** Evidence layer/source pair the collector uses for the scope entity set. */
const DECLARED_LAYER = "declared";
const PROJECT_PROFILE_SOURCE = "project-profile";
const KNOWLEDGE_LAYER = "knowledge";

/**
 * INTEL judgment (ADR-039) — recent threat-intel knowledge items matched
 * against the subject's scope entity set.
 *
 * Both inputs are read from `input.evidence` (ADR-037 D9.4): the collector
 * registers the scope entities as "declared" items and the knowledge
 * candidates as "knowledge" items, so the judgment no longer reads the
 * knowledge store or the scope port. Candidates ARE registered as evidence
 * items; items examined but not matched land in `evaluatedRefs` and
 * budget-truncated ones in `skipped` (ADR-037 D9.2/D9.4).
 *
 * Hard entity recall fires a finding directly (confidence high, verdictSource
 * "hard-recall"); otherwise the LLM re-ranks candidates that pass the
 * severity/signal threshold. Non-relevant LLM verdicts are negative-cached
 * per (item, scope) so they are not retried; unavailable verdicts are never
 * cached (ADR-018).
 */
@Injectable()
export class SecurityEvaluationIntelJudgment implements SecurityEvaluationJudgmentMechanism {
  readonly name = SECURITY_EVALUATION_MECHANISM_NAME_INTEL;

  constructor(private readonly matchService: SecurityEvaluationIntelMatchService) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    if (input.ruleSetVersion.evaluationKey !== SECURITY_EVALUATION_KEY_THREAT_INTEL) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    const entityItems = this.entityEvidence(input.evidence);
    const entities = this.entities(entityItems);
    const projection = this.candidates(input.evidence);
    if (entities.length === 0 || projection.candidates.length === 0) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    const scopeKey = `${input.subject.scopeType}:${input.subject.scopeId}`;
    const outcome = await this.matchService.match(projection.candidates, entities, scopeKey);
    const findings: EvaluationFindingCandidate[] = outcome.matches.map((match) => this.toFinding(match));

    const evaluatedRefs = [
      ...new Set(
        outcome.examinedRefs
          .map((knowledgeItemId) => projection.manifestIdByKnowledgeId.get(knowledgeItemId))
          .filter((id): id is string => typeof id === "string"),
      ),
    ];

    let skipped: EvaluationCoverageBucket | undefined;
    if (outcome.skippedByBudget) {
      const items = outcome.skippedByBudget.items
        .map((knowledgeItemId) => projection.manifestIdByKnowledgeId.get(knowledgeItemId))
        .filter((id): id is string => typeof id === "string");
      if (items.length > 0) {
        skipped = { total: items.length, items, note: outcome.skippedByBudget.note };
      }
    }

    return {
      verdicts: [],
      findings,
      evaluatedRefs,
      skipped,
      metadata: { matchedCount: outcome.matches.length, scopeEntities: entityItems.length },
    };
  }

  private entityEvidence(evidence: readonly EvaluationEvidenceItem[]): EvaluationEvidenceItem[] {
    return evidence.filter((item) => item.layer === DECLARED_LAYER && item.source === PROJECT_PROFILE_SOURCE);
  }

  private entities(entityItems: readonly EvaluationEvidenceItem[]): SecurityEvaluationScopeEntity[] {
    const entities: SecurityEvaluationScopeEntity[] = [];
    for (const item of entityItems) {
      const value = item.payload?.entity;
      if (typeof value === "string" && value.length > 0) entities.push({ value });
    }
    return entities;
  }

  private candidates(evidence: readonly EvaluationEvidenceItem[]): {
    candidates: IntelEvidenceCandidate[];
    manifestIdByKnowledgeId: Map<string, string>;
  } {
    const candidates: IntelEvidenceCandidate[] = [];
    const manifestIdByKnowledgeId = new Map<string, string>();
    for (const item of evidence) {
      if (item.layer !== KNOWLEDGE_LAYER) continue;
      const payload = item.payload;
      const knowledgeItemId = typeof payload?.knowledgeItemId === "string" ? payload.knowledgeItemId : undefined;
      if (!knowledgeItemId) continue;
      manifestIdByKnowledgeId.set(knowledgeItemId, item.id);
      candidates.push({
        knowledgeItemId,
        title: item.summary,
        // The collector carries the knowledge summary alongside the manifest
        // title so hard recall and the LLM see the same context.
        summary: typeof payload?.summary === "string" ? payload.summary : undefined,
        severity: typeof payload?.severity === "string" ? payload.severity : "info",
        signalTags: Array.isArray(payload?.signalTags)
          ? payload.signalTags.filter((tag): tag is string => typeof tag === "string")
          : [],
      });
    }
    return { candidates, manifestIdByKnowledgeId };
  }

  private toFinding(match: {
    itemId: string;
    itemTitle: string;
    itemSeverity: string;
    matchedEntity: string;
    confidence: string;
    evidence: string | null;
    verdictSource: "hard-recall" | "llm";
  }): EvaluationFindingCandidate {
    const severity = SEVERITY_TO_FINDING[match.itemSeverity as SecurityEvaluationKnowledgeSeverity] ?? "MEDIUM";
    return {
      criterionKey: SECURITY_EVALUATION_INTELLIGENCE_CRITERION_KEY,
      fingerprint: `threat-intel:${match.itemId}:${match.matchedEntity}`,
      severity,
      title: match.itemTitle,
      detail: match.evidence ?? undefined,
      metadata: {
        knowledgeItemId: match.itemId,
        matchedEntity: match.matchedEntity,
        confidence: match.confidence,
        verdictSource: match.verdictSource,
      },
    };
  }
}
