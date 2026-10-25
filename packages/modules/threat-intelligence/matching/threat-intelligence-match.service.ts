import { Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ThreatIntelligenceService } from "../threat-intelligence.service";
import { ThreatIntelligenceSeverity } from "../threat-intelligence.constants";
import {
  ScopeEntities,
  ScopeEntitiesProvider,
  THREAT_INTELLIGENCE_SCOPE_ENTITIES_PROVIDER,
} from "./scope-entities.port";
import { ThreatIntelligenceReRanker } from "./threat-intelligence-re-ranker";
import {
  THREAT_INTELLIGENCE_MATCH_CONFIDENCE,
  THREAT_INTELLIGENCE_MATCH_STATUS,
  THREAT_INTELLIGENCE_MATCH_TYPE,
} from "./threat-intelligence-match.constants";
import { ListThreatIntelligenceMatchesQuery } from "./threat-intelligence-match.dto";

const SEVERITY_RANK: Record<ThreatIntelligenceSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Items below this severity reach the LLM re-ranker only when they carry a signal tag (e.g. actively exploited). */
const RE_RANK_MIN_SEVERITY: ThreatIntelligenceSeverity = "medium";

/** How far back collection lookups consider items when matching. */
const DEFAULT_MATCH_WINDOW_DAYS = 7;

/**
 * Work budget for one matching run, counted in (item, scope) pairs rather
 * than items, so a bulk import cannot stall the event loop with LLM calls.
 * The window itself is always scanned end to end in cheap keyset pages;
 * only the expensive per-pair matcher is budgeted.
 */
const MATCH_PAIR_BUDGET_PER_RUN = 200;

/** Items read per keyset page while looking for pairs that still need work. */
const MATCH_SCAN_PAGE_SIZE = 200;

/** Fields returned by the match read/update APIs; everything else stays internal. */
const MATCH_SELECT = {
  id: true,
  itemId: true,
  scopeType: true,
  scopeId: true,
  matchType: true,
  matchedEntity: true,
  evidence: true,
  confidence: true,
  status: true,
  resolvedAt: true,
  createdAt: true,
} satisfies Prisma.ThreatIntelligenceMatchSelect;

interface MatchableItem {
  id: string;
  title: string;
  summary: string | null;
  severity: string;
  signalTags: string[];
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
 * The module's matching pipeline (ADR-018): decides which intel items
 * affect which matchable scopes (hard entity recall + LLM structured
 * re-rank, B3 protocol). Scope entities come from the host-bound
 * ScopeEntitiesProvider; without a binding the pipeline degrades to
 * collection-only and never invents matches.
 *
 * Emits "threat-intelligence.match-created" with
 * { matchId, scopeType, scopeId, itemId, confidence } for every newly
 * created match; re-evaluations stay silent. Notification fan-out is a host
 * concern.
 */
@Injectable()
export class ThreatIntelligenceMatchService {
  private readonly logger = new Logger(ThreatIntelligenceMatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly threatIntelService: ThreatIntelligenceService,
    @Optional()
    @Inject(THREAT_INTELLIGENCE_SCOPE_ENTITIES_PROVIDER)
    private readonly scopeEntitiesProvider: ScopeEntitiesProvider | undefined,
    private readonly reRanker: ThreatIntelligenceReRanker,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Full pipeline: collect from all sources, then match recent items
   * against every scope entity set. Used by the manual trigger endpoint
   * and by host schedulers.
   */
  async collectAndMatch(since?: Date): Promise<{ collected: number; evaluated: number; matched: number }> {
    const { collected } = await this.threatIntelService.collect(since);
    const windowStart = since ?? new Date(Date.now() - DEFAULT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { evaluated, matched } = await this.matchRecentItems(windowStart);
    return { collected, evaluated, matched };
  }

  /**
   * Match items fetched since `since` against all scope entity sets.
   *
   * The window is scanned oldest-first in keyset pages and pairs that already
   * produced a row are skipped before the budget is spent, so every run
   * advances through the backlog: a collection batch larger than one page can
   * never be permanently starved by newer items. `evaluated` counts the
   * (item, scope) pairs that actually reached the matcher.
   */
  async matchRecentItems(since: Date): Promise<{ evaluated: number; matched: number }> {
    if (!this.scopeEntitiesProvider) {
      this.logger.warn("No ScopeEntitiesProvider bound by the host; skipping matching (collection still ran).");
      return { evaluated: 0, matched: 0 };
    }
    const scopes = await this.scopeEntitiesProvider.listScopeEntities();
    if (scopes.length === 0) {
      this.logger.warn("Scope entity provider returned no scopes; skipping matching.");
      return { evaluated: 0, matched: 0 };
    }

    let cursorId: string | undefined;
    let evaluated = 0;
    let matched = 0;

    while (evaluated < MATCH_PAIR_BUDGET_PER_RUN) {
      const items = await this.prisma.threatIntelligenceItem.findMany({
        where: { fetchedAt: { gte: since } },
        orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
        take: MATCH_SCAN_PAGE_SIZE,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: { id: true, title: true, summary: true, severity: true, signalTags: true },
      });
      if (items.length === 0) break;
      cursorId = items[items.length - 1].id;

      // Skip (item, scope) pairs that already produced a match so a rerun
      // does not pay the LLM cost again.
      const existing = await this.prisma.threatIntelligenceMatch.findMany({
        where: { itemId: { in: items.map((item) => item.id) } },
        select: { itemId: true, scopeType: true, scopeId: true },
      });
      const alreadyMatched = new Set(existing.map((match) => `${match.itemId}:${match.scopeType}:${match.scopeId}`));

      for (const item of items) {
        for (const scope of scopes) {
          if (alreadyMatched.has(`${item.id}:${scope.scopeType}:${scope.scopeId}`)) continue;
          if (evaluated >= MATCH_PAIR_BUDGET_PER_RUN) break;
          matched += await this.matchItem(item, scope);
          evaluated += 1;
        }
        if (evaluated >= MATCH_PAIR_BUDGET_PER_RUN) break;
      }

      if (items.length < MATCH_SCAN_PAGE_SIZE) break;
    }

    return { evaluated, matched };
  }

  /**
   * Match one item against one scope entity set.
   *
   * Stage 1 (hard recall): exact entity substring match against title +
   * summary. Stage 2 (LLM re-rank): only for items that had no hard hit
   * AND meet the severity/signal threshold, to control token cost.
   *
   * Returns the number of matches created.
   */
  private async matchItem(item: MatchableItem, scope: ScopeEntities): Promise<number> {
    if (scope.entities.length === 0) {
      return 0;
    }

    const haystack = `${item.title}\n${item.summary ?? ""}`;
    const hardHits = scope.entities.filter((entity) => entityAppearsIn(haystack, entity.value));
    if (hardHits.length > 0) {
      return (await this.createMatch({
        itemId: item.id,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        matchType: THREAT_INTELLIGENCE_MATCH_TYPE.ENTITY,
        matchedEntity: hardHits[0].value,
        evidence: hardHits.map((hit) => hit.value).join(", "),
        confidence: THREAT_INTELLIGENCE_MATCH_CONFIDENCE.HIGH,
      }))
        ? 1
        : 0;
    }

    if (!this.shouldReRank(item.severity as ThreatIntelligenceSeverity, item.signalTags)) {
      return 0;
    }

    const verdict = await this.reRanker.reRank(
      { title: item.title, summary: item.summary ?? undefined },
      scope.entities,
    );
    if (!verdict.finalRelevant) {
      // Only an explicit not-relevant verdict is negative-cached. An
      // "unavailable" verdict means the LLM never judged the pair (scope
      // unbound, call failed, malformed output); caching it would suppress
      // re-evaluation for the rest of the item's match window, so the pair
      // is left untouched and retried on the next run.
      if (verdict.kind === "not-relevant") {
        await this.recordNotRelevant(item, scope, verdict.reason);
      }
      return 0;
    }

    const matchedEntity = verdict.entityMatches.find((match) => match.matched)?.entity ?? null;
    return (await this.createMatch({
      itemId: item.id,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      matchType: THREAT_INTELLIGENCE_MATCH_TYPE.SEMANTIC,
      matchedEntity,
      evidence: verdict.reason,
      confidence: THREAT_INTELLIGENCE_MATCH_CONFIDENCE.MEDIUM,
    }))
      ? 1
      : 0;
  }

  private shouldReRank(severity: ThreatIntelligenceSeverity, signalTags: string[]): boolean {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[RE_RANK_MIN_SEVERITY] || signalTags.length > 0;
  }

  /**
   * Negative-cache upsert: silent, never emits, never flips status.
   * Known limitation: the cache is keyed on (item, scope) only, so entity
   * set changes (a host adding entities to a scope) do not invalidate it —
   * the pair is skipped until the item ages out of the match window.
   */
  private async recordNotRelevant(item: MatchableItem, scope: ScopeEntities, reason: string): Promise<void> {
    await this.prisma.threatIntelligenceMatch.upsert({
      where: {
        scopeType_scopeId_itemId_matchedEntity: {
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          itemId: item.id,
          matchedEntity: "",
        },
      },
      update: {},
      create: {
        itemId: item.id,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        matchType: THREAT_INTELLIGENCE_MATCH_TYPE.SEMANTIC,
        matchedEntity: "",
        evidence: reason,
        confidence: THREAT_INTELLIGENCE_MATCH_CONFIDENCE.LOW,
        status: THREAT_INTELLIGENCE_MATCH_STATUS.FALSE_POSITIVE,
      },
    });
  }

  /**
   * Upsert one match row; returns true when the row was newly created.
   * The pre-select exists so callers count only new rows — an upsert alone
   * cannot report which branch ran, and `matched` must mean "new" to stay
   * consistent with what a digest fan-out actually sends.
   */
  private async createMatch(data: {
    itemId: string;
    scopeType: string;
    scopeId: string;
    matchType: string;
    matchedEntity: string | null;
    evidence: string | null;
    confidence: string;
  }): Promise<boolean> {
    // Avoid duplicate matches for the same (scope, item, entity).
    const uniqueWhere = {
      scopeType: data.scopeType,
      scopeId: data.scopeId,
      itemId: data.itemId,
      matchedEntity: data.matchedEntity ?? "",
    };
    const existing = await this.prisma.threatIntelligenceMatch.findUnique({
      where: { scopeType_scopeId_itemId_matchedEntity: uniqueWhere },
      select: { id: true },
    });
    const created = existing === null;
    const match = await this.prisma.threatIntelligenceMatch.upsert({
      where: { scopeType_scopeId_itemId_matchedEntity: uniqueWhere },
      update: {
        matchType: data.matchType,
        evidence: data.evidence,
        confidence: data.confidence,
        // status is deliberately not reset: a dispositioned match must not
        // flip back to open when a concurrent run re-evaluates the pair.
      },
      create: {
        itemId: data.itemId,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        matchType: data.matchType,
        matchedEntity: data.matchedEntity ?? "",
        evidence: data.evidence,
        confidence: data.confidence,
        status: THREAT_INTELLIGENCE_MATCH_STATUS.OPEN,
      },
    });
    // Re-evaluating an existing match must not look like a new finding to
    // subscribers (notifications are keyed on the created event semantics).
    if (created) {
      this.eventEmitter.emit("threat-intelligence.match-created", {
        matchId: match.id,
        scopeType: data.scopeType,
        scopeId: data.scopeId,
        itemId: data.itemId,
        confidence: data.confidence,
      });
    }
    return created;
  }

  async listMatches(query: ListThreatIntelligenceMatchesQuery) {
    const where: Prisma.ThreatIntelligenceMatchWhereInput = {};
    if (query.scopeType) where.scopeType = query.scopeType;
    if (query.scopeId) where.scopeId = query.scopeId;
    // False-positive rows are the LLM negative cache; they are only shown
    // when explicitly asked for.
    where.status = query.status ?? { not: THREAT_INTELLIGENCE_MATCH_STATUS.FALSE_POSITIVE };
    if (query.confidence) where.confidence = query.confidence;

    const [matches, total] = await Promise.all([
      this.prisma.threatIntelligenceMatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
        select: MATCH_SELECT,
      }),
      this.prisma.threatIntelligenceMatch.count({ where }),
    ]);

    // Match rows have no FK to items (the module prunes items), so join
    // titles with a second query; a pruned item yields itemTitle = null.
    const itemIds = [...new Set(matches.map((match) => match.itemId))];
    const items = await this.prisma.threatIntelligenceItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, title: true },
    });
    const titleByItemId = new Map(items.map((item) => [item.id, item.title]));

    return {
      matches: matches.map((match) => ({ ...match, itemTitle: titleByItemId.get(match.itemId) ?? null })),
      total,
    };
  }

  async getMatch(id: string) {
    const match = await this.prisma.threatIntelligenceMatch.findUnique({ where: { id }, select: MATCH_SELECT });
    if (!match) throw new NotFoundException(`Threat intel match ${id} not found.`);
    const item = await this.prisma.threatIntelligenceItem.findUnique({
      where: { id: match.itemId },
      select: { title: true },
    });
    return { ...match, itemTitle: item?.title ?? null };
  }

  async updateMatchStatus(id: string, status: string) {
    const match = await this.prisma.threatIntelligenceMatch.findUnique({ where: { id }, select: { id: true } });
    if (!match) throw new NotFoundException(`Threat intel match ${id} not found.`);
    return this.prisma.threatIntelligenceMatch.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === THREAT_INTELLIGENCE_MATCH_STATUS.RESOLVED ? new Date() : null,
      },
      select: MATCH_SELECT,
    });
  }
}
