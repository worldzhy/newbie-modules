import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ThreatIntelligenceMatchService } from "./threat-intelligence-match.service";
import { ScopeEntities, ScopeEntitiesProvider } from "./scope-entities.port";
import type { ReRankVerdict } from "./threat-intelligence-re-ranker";
import {
  THREAT_INTELLIGENCE_MATCH_CONFIDENCE,
  THREAT_INTELLIGENCE_MATCH_STATUS,
  THREAT_INTELLIGENCE_MATCH_TYPE,
} from "./threat-intelligence-match.constants";

/**
 * Behavior-level tests for the matching pipeline (ADR-018): provider
 * degradation, pair skipping, negative caching vs unavailable verdicts, and
 * the oldest-first scan that keeps a backlog from being starved by newer
 * collection batches.
 */

const DAY = 24 * 60 * 60 * 1000;

interface ItemRow {
  id: string;
  title: string;
  summary: string | null;
  severity: string;
  signalTags: string[];
  fetchedAt: Date;
}

/** Projection returned by the pipeline's item scan. */
type MatchableItemRow = Pick<ItemRow, "id" | "title" | "summary" | "severity" | "signalTags">;

interface MatchRow {
  id: string;
  itemId: string;
  scopeType: string;
  scopeId: string;
  matchType: string;
  matchedEntity: string;
  evidence: string | null;
  confidence: string;
  status: string;
}

function item(id: string, overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id,
    title: "Something unrelated happened",
    summary: null,
    severity: "high",
    signalTags: [],
    fetchedAt: new Date(Date.now() - 60 * 60 * 1000),
    ...overrides,
  };
}

class FakePrisma {
  items: ItemRow[] = [];
  matches: MatchRow[] = [];
  private sequence = 0;

  readonly threatIntelligenceItem = {
    findMany: async (args: {
      where: { fetchedAt: { gte: Date } };
      orderBy: unknown;
      take: number;
      cursor?: { id: string };
      skip?: number;
    }): Promise<MatchableItemRow[]> => {
      const since = args.where.fetchedAt.gte.getTime();
      let rows = this.items.filter((row) => row.fetchedAt.getTime() >= since);
      rows = [...rows].sort(
        (left, right) => left.fetchedAt.getTime() - right.fetchedAt.getTime() || left.id.localeCompare(right.id),
      );
      if (args.cursor) {
        const index = rows.findIndex((row) => row.id === args.cursor?.id);
        rows = rows.slice(index + (args.skip ?? 0));
      }
      return rows.slice(0, args.take).map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        severity: row.severity,
        signalTags: row.signalTags,
      }));
    },
  };

  readonly threatIntelligenceMatch = {
    findMany: async (args: { where: { itemId: { in: string[] } } }) =>
      this.matches
        .filter((match) => args.where.itemId.in.includes(match.itemId))
        .map((match) => ({ itemId: match.itemId, scopeType: match.scopeType, scopeId: match.scopeId })),

    findUnique: async (args: {
      where: {
        scopeType_scopeId_itemId_matchedEntity: Omit<
          MatchRow,
          "id" | "matchType" | "evidence" | "confidence" | "status"
        >;
      };
    }) => {
      const key = args.where.scopeType_scopeId_itemId_matchedEntity;
      const found = this.find(key);
      return found ? { id: found.id } : null;
    },

    upsert: async (args: {
      where: {
        scopeType_scopeId_itemId_matchedEntity: {
          scopeType: string;
          scopeId: string;
          itemId: string;
          matchedEntity: string;
        };
      };
      update: Partial<MatchRow>;
      create: Omit<MatchRow, "id">;
    }) => {
      const found = this.find(args.where.scopeType_scopeId_itemId_matchedEntity);
      if (found) {
        Object.assign(found, args.update);
        return { ...found };
      }
      this.sequence += 1;
      const created: MatchRow = { id: `match-${this.sequence}`, ...args.create };
      this.matches.push(created);
      return { ...created };
    },
  };

  private find(key: {
    scopeType: string;
    scopeId: string;
    itemId: string;
    matchedEntity: string;
  }): MatchRow | undefined {
    return this.matches.find(
      (match) =>
        match.scopeType === key.scopeType &&
        match.scopeId === key.scopeId &&
        match.itemId === key.itemId &&
        match.matchedEntity === key.matchedEntity,
    );
  }
}

class FakeReRanker {
  /** Verdicts are consumed in call order; the last one repeats. */
  queue: ReRankVerdict[] = [];
  calls: string[] = [];

  async reRank(itemState: { title: string }, entities: { value: string }[]): Promise<ReRankVerdict> {
    assert.ok(entities.length > 0, "reRanker must never be called with an empty entity set");
    this.calls.push(itemState.title);
    const verdict = this.queue.length > 1 ? this.queue.shift()! : this.queue[0];
    assert.ok(verdict, "test must queue at least one verdict");
    return verdict;
  }
}

function notRelevant(): ReRankVerdict {
  return {
    kind: "not-relevant",
    entityMatches: [],
    semanticMatch: false,
    finalRelevant: false,
    reason: "item is not about the scope",
  };
}

function unavailable(): ReRankVerdict {
  return {
    kind: "unavailable",
    entityMatches: [],
    semanticMatch: false,
    finalRelevant: false,
    reason: "chat model is not bound",
  };
}

function relevant(entity: string): ReRankVerdict {
  return {
    kind: "relevant",
    entityMatches: [{ entity, matched: true, evidence: "mentions the entity" }],
    semanticMatch: true,
    finalRelevant: true,
    reason: "the item affects the entity",
  };
}

interface Harness {
  prisma: FakePrisma;
  reRanker: FakeReRanker;
  events: { name: string; payload: unknown }[];
  service: ThreatIntelligenceMatchService;
}

function createHarness(options: { scopes?: ScopeEntities[] | null } = {}): Harness {
  const prisma = new FakePrisma();
  const reRanker = new FakeReRanker();
  const events: { name: string; payload: unknown }[] = [];
  const provider: ScopeEntitiesProvider | undefined =
    options.scopes === null
      ? undefined
      : {
          listScopeEntities: async () => options.scopes ?? [],
        };
  const service = new ThreatIntelligenceMatchService(
    prisma as never,
    {} as never,
    provider as never,
    reRanker as never,
    { emit: (name: string, payload: unknown) => events.push({ name, payload }) } as never,
    { declareEvent: () => undefined } as never,
  );
  return { prisma, reRanker, events, service };
}

const projectScope: ScopeEntities = {
  scopeType: "project",
  scopeId: "project-1",
  entities: [
    { value: "next", context: "framework" },
    { value: "postgres", context: "database" },
  ],
};

const windowStart = new Date(Date.now() - 7 * DAY);

describe("ThreatIntelligenceMatchService.matchRecentItems", () => {
  it("degrades to collection-only when the host binds no provider", async () => {
    const { prisma, reRanker, events, service } = createHarness({ scopes: null });
    prisma.items = [item("item-1", { title: "next.js advisory" })];

    const result = await service.matchRecentItems(windowStart);

    assert.deepEqual(result, { evaluated: 0, matched: 0 });
    assert.equal(reRanker.calls.length, 0);
    assert.equal(prisma.matches.length, 0);
    assert.equal(events.length, 0);
  });

  it("does nothing when the provider lists no scopes", async () => {
    const { prisma, reRanker, service } = createHarness({ scopes: [] });
    prisma.items = [item("item-1", { title: "next.js advisory" })];

    const result = await service.matchRecentItems(windowStart);

    assert.deepEqual(result, { evaluated: 0, matched: 0 });
    assert.equal(reRanker.calls.length, 0);
    assert.equal(prisma.matches.length, 0);
  });

  it("skips a pair that already produced a row, including the negative cache", async () => {
    const { prisma, reRanker, events, service } = createHarness({ scopes: [projectScope] });
    prisma.items = [item("item-1", { title: "next.js advisory" })];
    prisma.matches = [
      {
        id: "match-existing",
        itemId: "item-1",
        scopeType: projectScope.scopeType,
        scopeId: projectScope.scopeId,
        matchType: THREAT_INTELLIGENCE_MATCH_TYPE.SEMANTIC,
        matchedEntity: "",
        evidence: "cached as not relevant",
        confidence: THREAT_INTELLIGENCE_MATCH_CONFIDENCE.LOW,
        status: THREAT_INTELLIGENCE_MATCH_STATUS.FALSE_POSITIVE,
      },
    ];

    const result = await service.matchRecentItems(windowStart);

    assert.deepEqual(result, { evaluated: 0, matched: 0 });
    assert.equal(reRanker.calls.length, 0);
    assert.equal(prisma.matches.length, 1);
    assert.equal(events.length, 0);
  });

  it("creates a high-confidence entity match on a hard recall hit without calling the LLM", async () => {
    const { prisma, reRanker, events, service } = createHarness({ scopes: [projectScope] });
    prisma.items = [item("item-1", { title: "Critical vulnerability in next.js" })];

    const result = await service.matchRecentItems(windowStart);

    assert.deepEqual(result, { evaluated: 1, matched: 1 });
    assert.equal(reRanker.calls.length, 0);
    assert.equal(prisma.matches.length, 1);
    assert.equal(prisma.matches[0].matchType, THREAT_INTELLIGENCE_MATCH_TYPE.ENTITY);
    assert.equal(prisma.matches[0].matchedEntity, "next");
    assert.equal(prisma.matches[0].confidence, THREAT_INTELLIGENCE_MATCH_CONFIDENCE.HIGH);
    assert.equal(prisma.matches[0].status, THREAT_INTELLIGENCE_MATCH_STATUS.OPEN);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, "threat-intelligence.match-created");
  });

  it("negative-caches an explicit not-relevant verdict without emitting", async () => {
    const { prisma, reRanker, events, service } = createHarness({ scopes: [projectScope] });
    prisma.items = [item("item-1")];
    reRanker.queue = [notRelevant()];

    const result = await service.matchRecentItems(windowStart);

    assert.deepEqual(result, { evaluated: 1, matched: 0 });
    assert.equal(reRanker.calls.length, 1);
    assert.equal(prisma.matches.length, 1);
    assert.equal(prisma.matches[0].matchedEntity, "");
    assert.equal(prisma.matches[0].status, THREAT_INTELLIGENCE_MATCH_STATUS.FALSE_POSITIVE);
    assert.equal(events.length, 0);
  });

  it("leaves unavailable verdicts uncached so the next run retries the pair", async () => {
    const { prisma, reRanker, events, service } = createHarness({ scopes: [projectScope] });
    prisma.items = [item("item-1")];
    reRanker.queue = [unavailable(), relevant("postgres")];

    const first = await service.matchRecentItems(windowStart);
    assert.deepEqual(first, { evaluated: 1, matched: 0 });
    assert.equal(prisma.matches.length, 0, "unavailable must not be negative-cached");
    assert.equal(events.length, 0);

    const second = await service.matchRecentItems(windowStart);
    assert.deepEqual(second, { evaluated: 1, matched: 1 });
    assert.equal(reRanker.calls.length, 2, "the retry must re-enter the matcher");
    assert.equal(prisma.matches.length, 1);
    assert.equal(prisma.matches[0].confidence, THREAT_INTELLIGENCE_MATCH_CONFIDENCE.MEDIUM);
    assert.equal(events.length, 1);
  });

  it("drains a backlog larger than the per-run budget oldest-first instead of starving it", async () => {
    const { prisma, reRanker, service } = createHarness({ scopes: [projectScope] });
    prisma.items = Array.from({ length: 250 }, (_, index) => {
      const ordinal = String(index + 1).padStart(4, "0");
      return item(`item-${ordinal}`, {
        title: `unrelated bulletin ${ordinal}`,
        fetchedAt: new Date(Date.now() - (250 - index) * 60 * 1000),
      });
    });
    reRanker.queue = [notRelevant()];

    const first = await service.matchRecentItems(windowStart);
    assert.deepEqual(first, { evaluated: 200, matched: 0 });
    assert.equal(prisma.matches.length, 200);
    assert.equal(reRanker.calls[0], "unrelated bulletin 0001", "oldest item must go first");

    const second = await service.matchRecentItems(windowStart);
    assert.deepEqual(second, { evaluated: 50, matched: 0 });
    assert.equal(reRanker.calls.length, 250);
    assert.equal(
      reRanker.calls[200],
      "unrelated bulletin 0201",
      "the next run must continue past the evaluated prefix",
    );
    assert.equal(prisma.matches.length, 250);

    const third = await service.matchRecentItems(windowStart);
    assert.deepEqual(third, { evaluated: 0, matched: 0 });
  });
});
