import { Inject, Injectable } from "@nestjs/common";
import { SecurityEvaluationKnowledgeSeverity } from "../../knowledge/security-evaluation-knowledge.constants";
import { SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET } from "../../security-evaluation.constants";
import { SecurityEvaluationScopeEntity } from "./security-evaluation-scope-entities.port";
import { SecurityEvaluationIntelReRanker } from "./security-evaluation-intel-re-ranker";
import {
  securityEvaluationIntelNegativeCacheToken,
  SecurityEvaluationIntelNegativeCachePort,
} from "./security-evaluation-intel-negative-cache.port";
import {
  SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE,
  type SecurityEvaluationIntelMatchConfidence,
} from "./security-evaluation-intel-match.constants";

const SEVERITY_RANK: Record<SecurityEvaluationKnowledgeSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Items below this severity reach the LLM re-ranker only when they carry a signal tag. */
const RE_RANK_MIN_SEVERITY: SecurityEvaluationKnowledgeSeverity = "medium";

/** One knowledge candidate the judgment passed in from the run's evidence items. */
export interface IntelEvidenceCandidate {
  knowledgeItemId: string;
  title: string;
  summary?: string | null;
  severity: string;
  signalTags: string[];
}

export interface IntelMatchResult {
  itemId: string;
  itemTitle: string;
  itemSeverity: string;
  matchedEntity: string;
  confidence: SecurityEvaluationIntelMatchConfidence;
  evidence: string | null;
  verdictSource: "hard-recall" | "llm";
}

export interface IntelMatchOutcome {
  /** Knowledge items judged relevant; each becomes a finding. */
  matches: IntelMatchResult[];
  /**
   * Knowledge item ids of every candidate that was actually examined — a
   * hard-recall hit or an LLM verdict of relevant/not-relevant. Budget
   * truncation and unavailable LLM verdicts leave a candidate out.
   */
  examinedRefs: string[];
  /**
   * Candidates the re-rank budget cut off, with knowledge item ids and a note
   * naming the budget. Undefined when the budget covered every candidate.
   */
  skippedByBudget?: { items: string[]; note: string };
}

/**
 * Case-insensitive whole-word containment. Word boundaries apply when the
 * entity has ASCII word edges ("next" must not hit "nextcloud"); entities
 * with non-ASCII edges (e.g. Chinese names) fall back to substring matching.
 */
function entityAppearsIn(haystack: string, entity: string): boolean {
  const trimmed = entity.trim();
  if (!/^\w/.test(trimmed) || !/\w$/.test(trimmed)) {
    return haystack.toLowerCase().includes(trimmed.toLowerCase());
  }
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * INTEL matching service (ADR-018, re-homed under security-evaluation by
 * ADR-039). Matching is pure over the candidate and entity lists the caller
 * passes: candidates are already filtered and projected from the run's
 * evidence items, so this service reads neither the knowledge store nor the
 * scope port itself.
 *
 * The LLM re-rank budget bounds how many candidates a single run may spend a
 * call on; hard-recall hits do not consume it (ADR-037 D9.4). A "not-relevant"
 * verdict is written through the negative-cache port keyed by
 * "scopeType:scopeId" (ADR-045); "unavailable" verdicts are never cached.
 */
@Injectable()
export class SecurityEvaluationIntelMatchService {
  constructor(
    @Inject(securityEvaluationIntelNegativeCacheToken)
    private readonly negativeCache: SecurityEvaluationIntelNegativeCachePort,
    private readonly reRanker: SecurityEvaluationIntelReRanker,
  ) {}

  async match(
    candidates: readonly IntelEvidenceCandidate[],
    entities: readonly SecurityEvaluationScopeEntity[],
    scopeKey: string,
  ): Promise<IntelMatchOutcome> {
    if (entities.length === 0 || candidates.length === 0) {
      return { matches: [], examinedRefs: [] };
    }

    const matches: IntelMatchResult[] = [];
    const examinedRefs: string[] = [];
    const skippedByBudget: string[] = [];
    let reRankCalls = 0;

    for (const candidate of candidates) {
      const haystack = `${candidate.title}\n${candidate.summary ?? ""}`;
      const hardHits = entities.filter((entity) => entityAppearsIn(haystack, entity.value));

      if (hardHits.length > 0) {
        matches.push({
          itemId: candidate.knowledgeItemId,
          itemTitle: candidate.title,
          itemSeverity: candidate.severity,
          matchedEntity: hardHits[0].value,
          confidence: SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE.HIGH,
          evidence: hardHits.map((hit) => hit.value).join(", "),
          verdictSource: "hard-recall",
        });
        examinedRefs.push(candidate.knowledgeItemId);
        continue;
      }

      if (!this.shouldReRank(candidate.severity as SecurityEvaluationKnowledgeSeverity, candidate.signalTags)) {
        continue;
      }

      if (reRankCalls >= SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET) {
        skippedByBudget.push(candidate.knowledgeItemId);
        continue;
      }
      reRankCalls += 1;

      const verdict = await this.reRanker.reRank({ title: candidate.title, summary: candidate.summary ?? undefined }, [
        ...entities,
      ]);

      if (verdict.kind === "unavailable") continue;

      examinedRefs.push(candidate.knowledgeItemId);

      if (!verdict.finalRelevant) {
        if (verdict.kind === "not-relevant") {
          await this.negativeCache.record(candidate.knowledgeItemId, scopeKey, verdict.reason);
        }
        continue;
      }

      const matchedEntity = verdict.entityMatches.find((m) => m.matched)?.entity ?? "";
      matches.push({
        itemId: candidate.knowledgeItemId,
        itemTitle: candidate.title,
        itemSeverity: candidate.severity,
        matchedEntity,
        confidence: SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE.MEDIUM,
        evidence: verdict.reason,
        verdictSource: "llm",
      });
    }

    const outcome: IntelMatchOutcome = { matches, examinedRefs };
    if (skippedByBudget.length > 0) {
      outcome.skippedByBudget = {
        items: skippedByBudget,
        note: `${skippedByBudget.length} candidate(s) were not re-ranked because the run's LLM re-rank budget of ${SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET} was exhausted.`,
      };
    }
    return outcome;
  }

  private shouldReRank(severity: SecurityEvaluationKnowledgeSeverity, signalTags: string[]): boolean {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[RE_RANK_MIN_SEVERITY] || signalTags.length > 0;
  }
}
