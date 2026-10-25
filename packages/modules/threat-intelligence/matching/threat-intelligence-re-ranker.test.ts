import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ThreatIntelligenceReRanker, type ReRankVerdict } from "./threat-intelligence-re-ranker";
import type { ProfileEntity } from "./scope-entities.port";

/**
 * Behavior-level tests for the B3 matching protocol.
 *
 * The hard constraint is the most important contract: finalRelevant must
 * require at least one entity match, and semanticMatch alone can never
 * pass. These tests exercise the reRanker through its public API with a
 * mocked chat model so the constraint is verified end-to-end.
 */

const entities: ProfileEntity[] = [
  { value: "next", context: "framework" },
  { value: "postgres", context: "database" },
];

class FakeChatModel {
  constructor(private readonly text: string) {}
  async complete(): Promise<{ text: string }> {
    return { text: this.text };
  }
}

class FakeResolver {
  constructor(private readonly text: string) {}
  async resolve(): Promise<InstanceType<typeof FakeChatModel>> {
    return new FakeChatModel(this.text) as never;
  }
}

function reRankerWith(text: string): ThreatIntelligenceReRanker {
  return new ThreatIntelligenceReRanker(new FakeResolver(text) as never);
}

class FailingResolver {
  async resolve(): Promise<never> {
    throw new Error("scope not bound");
  }
}

function reRankerWithoutScope(): ThreatIntelligenceReRanker {
  return new ThreatIntelligenceReRanker(new FailingResolver() as never);
}

function verdictJson(overrides: Partial<ReRankVerdict>): string {
  const base: ReRankVerdict = {
    kind: "not-relevant",
    entityMatches: entities.map((e) => ({ entity: e.value, matched: false, evidence: null })),
    semanticMatch: false,
    finalRelevant: false,
    reason: "test",
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe("threat-intelligence B3 re-rank hard constraint", () => {
  it("passes when at least one entity match is true", async () => {
    const reRanker = reRankerWith(
      verdictJson({
        entityMatches: [
          { entity: "next", matched: true, evidence: "CVE affects next" },
          { entity: "postgres", matched: false, evidence: null },
        ],
        finalRelevant: true,
      }),
    );
    const verdict = await reRanker.reRank({ title: "CVE in next.js" }, entities);
    assert.equal(verdict.finalRelevant, true);
    assert.equal(verdict.entityMatches.find((m) => m.entity === "next")?.matched, true);
  });

  it("forces finalRelevant=false when the LLM returns true without any entity match", async () => {
    // LLM tries to pass on semanticMatch alone — the hard constraint must reject it.
    const reRanker = reRankerWith(
      verdictJson({
        semanticMatch: true,
        finalRelevant: true,
        reason: "topically related",
      }),
    );
    const verdict = await reRanker.reRank({ title: "Some security news" }, entities);
    assert.equal(verdict.finalRelevant, false, "semanticMatch alone must never pass");
  });

  it("rejects the verdict when the LLM returns entities not in the input profile", async () => {
    const reRanker = reRankerWith(
      verdictJson({
        entityMatches: [{ entity: "lodash", matched: true, evidence: "injected" }],
        finalRelevant: true,
      }),
    );
    const verdict = await reRanker.reRank({ title: "anything" }, entities);
    assert.equal(verdict.finalRelevant, false);
    assert.equal(
      verdict.entityMatches.every((m) => m.matched === false),
      true,
    );
  });

  it("returns not-relevant with empty entity list without calling the LLM", async () => {
    const reRanker = reRankerWith("should not be used");
    const verdict = await reRanker.reRank({ title: "anything" }, []);
    assert.equal(verdict.finalRelevant, false);
    assert.equal(verdict.entityMatches.length, 0);
  });

  it("marks malformed LLM output as unavailable so the caller does not negative-cache it", async () => {
    const reRanker = reRankerWith("not json at all");
    const verdict = await reRanker.reRank({ title: "anything" }, entities);
    assert.equal(verdict.finalRelevant, false);
    assert.equal(verdict.kind, "unavailable");
  });

  it("marks an unbound LLM scope as unavailable so the caller does not negative-cache it", async () => {
    const verdict = await reRankerWithoutScope().reRank({ title: "anything" }, entities);
    assert.equal(verdict.finalRelevant, false);
    assert.equal(verdict.kind, "unavailable");
  });

  it("marks a clean LLM not-relevant verdict as not-relevant (cacheable)", async () => {
    const reRanker = reRankerWith(verdictJson({ semanticMatch: false, finalRelevant: false }));
    const verdict = await reRanker.reRank({ title: "unrelated news" }, entities);
    assert.equal(verdict.kind, "not-relevant");
  });
});
