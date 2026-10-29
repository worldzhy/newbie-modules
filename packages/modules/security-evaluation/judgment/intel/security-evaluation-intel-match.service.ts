import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { SecurityEvaluationKnowledgeSeverity } from "../../knowledge/security-evaluation-knowledge.constants";
import {
  SecurityEvaluationScopeEntities,
  SecurityEvaluationScopeEntitiesProvider,
  SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER,
} from "./security-evaluation-scope-entities.port";
import { SecurityEvaluationIntelReRanker } from "./security-evaluation-intel-re-ranker";
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

/** How far back the INTEL judgment considers items when matching. */
const DEFAULT_MATCH_WINDOW_DAYS = 7;

interface MatchableItem {
  id: string;
  title: string;
  summary: string | null;
  severity: string;
  signalTags: string[];
  negativeCache: Prisma.JsonValue | null;
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
 * ADR-039). Per-subject matching: given a scope's entity set, decide which
 * knowledge items affect it via hard entity recall + LLM structured re-rank.
 *
 * Unlike the former threat-intelligence module's global match pipeline,
 * this service is invoked per evaluation run for one subject's scope.
 * Negative cache is stored on `SecurityEvaluationThreatKnowledgeItem.negativeCache`
 * keyed by "scopeType:scopeId"; "unavailable" verdicts are never cached.
 */
@Injectable()
export class SecurityEvaluationIntelMatchService {
  private readonly logger = new Logger(SecurityEvaluationIntelMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER)
    private readonly scopeEntitiesProvider: SecurityEvaluationScopeEntitiesProvider | undefined,
    private readonly reRanker: SecurityEvaluationIntelReRanker,
  ) {}

  /**
   * Match knowledge items from the last `windowDays` days against the given
   * scope's entity set. Returns the list of relevant matches (each becomes
   * a finding). Items with a cached "not-relevant" verdict for this scope
   * are skipped.
   */
  async matchScope(
    scope: SecurityEvaluationScopeEntities,
    windowDays = DEFAULT_MATCH_WINDOW_DAYS,
  ): Promise<IntelMatchResult[]> {
    if (scope.entities.length === 0) return [];

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const scopeKey = `${scope.scopeType}:${scope.scopeId}`;

    const items = await this.prisma.securityEvaluationThreatKnowledgeItem.findMany({
      where: { fetchedAt: { gte: since } },
      orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        summary: true,
        severity: true,
        signalTags: true,
        negativeCache: true,
      },
    });

    const results: IntelMatchResult[] = [];
    for (const item of items) {
      const cache = (item.negativeCache as Record<string, string> | null) ?? {};
      if (cache[scopeKey] !== undefined) continue;

      const result = await this.matchItem(item, scope, scopeKey);
      if (result) results.push(result);
    }
    return results;
  }

  private async matchItem(
    item: MatchableItem,
    scope: SecurityEvaluationScopeEntities,
    scopeKey: string,
  ): Promise<IntelMatchResult | null> {
    const haystack = `${item.title}\n${item.summary ?? ""}`;
    const hardHits = scope.entities.filter((entity) => entityAppearsIn(haystack, entity.value));

    if (hardHits.length > 0) {
      return {
        itemId: item.id,
        itemTitle: item.title,
        itemSeverity: item.severity,
        matchedEntity: hardHits[0].value,
        confidence: SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE.HIGH,
        evidence: hardHits.map((hit) => hit.value).join(", "),
        verdictSource: "hard-recall",
      };
    }

    if (!this.shouldReRank(item.severity as SecurityEvaluationKnowledgeSeverity, item.signalTags)) {
      return null;
    }

    const verdict = await this.reRanker.reRank(
      { title: item.title, summary: item.summary ?? undefined },
      scope.entities,
    );

    if (!verdict.finalRelevant) {
      if (verdict.kind === "not-relevant") {
        await this.cacheNotRelevant(item.id, scopeKey, verdict.reason);
      }
      return null;
    }

    const matchedEntity = verdict.entityMatches.find((m) => m.matched)?.entity ?? "";
    return {
      itemId: item.id,
      itemTitle: item.title,
      itemSeverity: item.severity,
      matchedEntity,
      confidence: SECURITY_EVALUATION_INTEL_MATCH_CONFIDENCE.MEDIUM,
      evidence: verdict.reason,
      verdictSource: "llm",
    };
  }

  private shouldReRank(severity: SecurityEvaluationKnowledgeSeverity, signalTags: string[]): boolean {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[RE_RANK_MIN_SEVERITY] || signalTags.length > 0;
  }

  private async cacheNotRelevant(itemId: string, scopeKey: string, reason: string): Promise<void> {
    const item = await this.prisma.securityEvaluationThreatKnowledgeItem.findUnique({
      where: { id: itemId },
      select: { negativeCache: true },
    });
    if (!item) return;
    const cache = (item.negativeCache as Record<string, string> | null) ?? {};
    cache[scopeKey] = reason;
    await this.prisma.securityEvaluationThreatKnowledgeItem.update({
      where: { id: itemId },
      data: { negativeCache: cache as Prisma.InputJsonValue },
    });
  }
}
