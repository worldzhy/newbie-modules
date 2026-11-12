import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import type { EvaluationRuleSetVersionRef, EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import type { SecurityEvaluationCodeScanExcerptService } from "./evidence/security-evaluation-code-scan-excerpt.service";
import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import { SecurityEvaluationIntelJudgment } from "./judgment/intel/security-evaluation-intel.judgment";
import { SecurityEvaluationIntelMatchService } from "./judgment/intel/security-evaluation-intel-match.service";
import { SecurityEvaluationIntelReRanker } from "./judgment/intel/security-evaluation-intel-re-ranker";
import type { SecurityEvaluationIntelNegativeCachePort } from "./judgment/intel/security-evaluation-intel-negative-cache.port";
import { buildSecurityEvaluationIntelReRankRequest } from "./judgment/intel/security-evaluation-intel-request";
import type {
  SecurityEvaluationScopeEntitiesProvider,
  SecurityEvaluationScopeEntity,
} from "./judgment/intel/security-evaluation-scope-entities.port";
import { SecurityEvaluationIntelNegativeCacheRepository } from "./persistence/security-evaluation-intel-negative-cache.repository";
import {
  SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET,
  SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for INTEL evidence registration (ADR-037 D9.4): the
 * run manifest registers the candidates it considered, the negative cache and
 * the evidence budget are accounted in the skipped bucket, and the judgment
 * derives evaluatedRefs/skipped from those manifest items instead of the
 * knowledge store.
 */

const SUBJECT: EvaluationSubjectRef = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "repository",
  scopeType: "platform",
  scopeId: "deployment",
  subjectKey: "application-1",
  displayName: "nightwatch-backend",
};

const INTEL_VERSION: EvaluationRuleSetVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "repository",
  evaluationKey: "threat-intel",
  version: "v1",
};

const SCOPE_KEY = `${SUBJECT.kind}:${SUBJECT.subjectKey}`;

interface IntelRow {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  severity: string;
  signalTags: string[];
  fetchedAt: Date;
  negativeCache: Record<string, string> | null;
}

function row(id: string, overrides: Partial<IntelRow> = {}): IntelRow {
  return {
    id,
    source: "ghsa",
    title: `advisory ${id}`,
    summary: null,
    severity: "high",
    signalTags: [],
    fetchedAt: new Date("2026-10-30T00:00:00.000Z"),
    negativeCache: null,
    ...overrides,
  };
}

function stubPrisma(rows: IntelRow[]): PrismaService {
  return {
    securityEvaluationThreatKnowledgeItem: {
      findMany: async () => rows,
    },
  } as unknown as PrismaService;
}

function stubNegativeCache(rows: IntelRow[] = []) {
  const recorded: { knowledgeItemId: string; scopeKey: string; verdict: string; signature: string }[] = [];
  const seenScopeKeys: string[] = [];
  const cachedIds = new Set(rows.filter((row) => row.negativeCache?.[SCOPE_KEY] !== undefined).map((row) => row.id));
  const port: SecurityEvaluationIntelNegativeCachePort = {
    filterUncached: async (scopeKey, candidates) => {
      seenScopeKeys.push(scopeKey);
      return candidates
        .filter((candidate) => !cachedIds.has(candidate.knowledgeItemId))
        .map((candidate) => candidate.knowledgeItemId);
    },
    record: async (entry) => {
      recorded.push({
        knowledgeItemId: entry.knowledgeItemId,
        scopeKey: entry.scopeKey,
        verdict: entry.verdict,
        signature: entry.signature,
      });
    },
  };
  return { port, recorded, seenScopeKeys };
}

const SCOPE_PROVIDER: SecurityEvaluationScopeEntitiesProvider = {
  listScopeEntities: async () => [{ value: "next" }, { value: "nightwatch-backend" }],
};

function stubAssets(): SecurityEvaluationAssetService {
  return {
    getOrCreateAsset: async () => ({ id: "asset-1" }),
  } as unknown as SecurityEvaluationAssetService;
}

function stubReRanker(
  verdict: { finalRelevant: boolean; kind: "relevant" | "not-relevant" | "unavailable"; reason: string },
  entity = "next",
): SecurityEvaluationIntelReRanker {
  return {
    currentModelId: async () => "stub-model",
    reRank: async () => ({
      kind: verdict.kind,
      entityMatches: [{ entity, matched: verdict.finalRelevant, evidence: null }],
      semanticMatch: false,
      finalRelevant: verdict.finalRelevant,
      reason: verdict.reason,
      signature: "stub-signature",
    }),
  } as unknown as SecurityEvaluationIntelReRanker;
}

function buildEvidence(prisma: PrismaService, negativeCache: SecurityEvaluationIntelNegativeCachePort) {
  return new SecurityEvaluationEvidenceProvider(
    prisma,
    stubAssets(),
    negativeCache,
    stubExcerpts(),
    undefined,
    SCOPE_PROVIDER,
  ).collect(SUBJECT, INTEL_VERSION);
}

function stubExcerpts(): SecurityEvaluationCodeScanExcerptService {
  return {
    save: async () => {},
    load: async () => new Map(),
    pruneExpired: async () => ({ deleted: 0 }),
  } as unknown as SecurityEvaluationCodeScanExcerptService;
}

function judgmentInput(evidence: Awaited<ReturnType<typeof buildEvidence>>["items"]): JudgmentInput {
  return {
    subject: {
      id: SUBJECT.id,
      scopeType: SUBJECT.scopeType,
      scopeId: SUBJECT.scopeId,
      subjectKey: SUBJECT.subjectKey,
      displayName: SUBJECT.displayName,
    },
    ruleSetVersion: INTEL_VERSION,
    criteria: [],
    evidence,
    runConfig: null,
  };
}

test("INTEL candidates are registered as knowledge evidence items and negative-cached ones are skipped", async () => {
  const rows = [
    row("kn-1", { title: "Next.js advisory", severity: "high", summary: "Affects next@<14.2." }),
    row("kn-2", { negativeCache: { [SCOPE_KEY]: "not relevant" } }),
  ];
  const { port, seenScopeKeys } = stubNegativeCache(rows);

  const evidence = await buildEvidence(stubPrisma(rows), port);
  assert.deepEqual(seenScopeKeys, [SCOPE_KEY]);
  const knowledge = evidence.items.filter((item) => item.layer === "knowledge");
  assert.deepEqual(
    knowledge.map((item) => [item.id, item.source, item.summary, item.refs]),
    [["threat-knowledge:kn-1", "ghsa", "Next.js advisory", ["kn-1"]]],
  );
  assert.equal(knowledge[0].payload?.knowledgeItemId, "kn-1");
  assert.equal(knowledge[0].payload?.severity, "high");
  assert.equal(knowledge[0].payload?.summary, "Affects next@<14.2.");
  assert.equal(evidence.items.filter((item) => item.layer === "declared").length, 2);
  assert.equal(evidence.skipped.total, 1);
  assert.deepEqual(evidence.skipped.items, ["kn-2"]);
  assert.match(evidence.skipped.note ?? "", /negative cache/);
});

test("candidates beyond the evidence budget are counted in the same skipped bucket", async () => {
  const rows = Array.from({ length: SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET + 2 }, (_, index) =>
    row(`budget-${index}`),
  );
  rows[0].negativeCache = { [SCOPE_KEY]: "not relevant" };

  const { port } = stubNegativeCache(rows);
  const evidence = await buildEvidence(stubPrisma(rows), port);

  const knowledge = evidence.items.filter((item) => item.layer === "knowledge");
  assert.equal(knowledge.length, SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET);
  assert.equal(evidence.skipped.total, 2);
  assert.deepEqual(evidence.skipped.items, ["budget-0", "budget-201"]);
  assert.match(evidence.skipped.note ?? "", /negative cache/);
  assert.match(evidence.skipped.note ?? "", new RegExp(`budget of ${SECURITY_EVALUATION_INTEL_EVIDENCE_BUDGET}`));
});

test("the judgment maps examined candidates to manifest ids and budget cut-offs to skipped", async () => {
  const rows = [
    row("hard", { title: "Next.js remote code execution", severity: "critical" }),
    row("not-relevant", { title: "Apache httpd issue", severity: "high" }),
    row("below-threshold", { title: "informational note", severity: "low", signalTags: [] }),
  ];
  const { port, recorded } = stubNegativeCache(rows);
  const evidence = await buildEvidence(stubPrisma(rows), port);
  const matchService = new SecurityEvaluationIntelMatchService(
    port,
    stubReRanker({ kind: "not-relevant", finalRelevant: false, reason: "No entity impact." }),
  );
  const judgment = new SecurityEvaluationIntelJudgment(matchService);

  const result = await judgment.judge(judgmentInput(evidence.items));

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].metadata?.knowledgeItemId, "hard");
  assert.deepEqual(result.evaluatedRefs, ["threat-knowledge:hard", "threat-knowledge:not-relevant"]);
  assert.equal(result.skipped, undefined);
  assert.deepEqual(result.metadata, { matchedCount: 1, scopeEntities: 2 });
  assert.deepEqual(
    recorded.map((entry) => entry.knowledgeItemId),
    // The hard recall match is recorded as an audit-only "hard-hit" row; the
    // re-ranked candidate is recorded as "not-relevant".
    ["hard", "not-relevant"],
  );
  assert.ok(recorded.every((entry) => entry.scopeKey === SCOPE_KEY));
});

test("the re-rank budget leaves overflow candidates in the judgment skipped bucket", async () => {
  const rows = Array.from({ length: SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET + 2 }, (_, index) =>
    row(`rerank-${index}`, { title: `advisory ${index}`, severity: "high" }),
  );
  const { port, recorded } = stubNegativeCache(rows);
  const evidence = await buildEvidence(stubPrisma(rows), port);
  const matchService = new SecurityEvaluationIntelMatchService(
    port,
    stubReRanker({ kind: "not-relevant", finalRelevant: false, reason: "No entity impact." }),
  );
  const judgment = new SecurityEvaluationIntelJudgment(matchService);

  const result = await judgment.judge(judgmentInput(evidence.items));

  assert.equal(result.evaluatedRefs.length, SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET);
  assert.equal(result.skipped?.total, 2);
  assert.deepEqual(result.skipped?.items, ["threat-knowledge:rerank-100", "threat-knowledge:rerank-101"]);
  assert.match(result.skipped?.note ?? "", new RegExp(`budget of ${SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET}`));
  assert.equal(recorded.length, SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET);
});

test("INTEL collection fails closed on an unknown subject and short-circuits a subject with no entities", async () => {
  const { port } = stubNegativeCache();
  const build = (scope: SecurityEvaluationScopeEntitiesProvider | undefined) =>
    new SecurityEvaluationEvidenceProvider(
      stubPrisma([]),
      stubAssets(),
      port,
      stubExcerpts(),
      undefined,
      scope,
    ).collect(SUBJECT, INTEL_VERSION);

  await assert.rejects(() => build(undefined), /No SecurityEvaluationScopeEntitiesProvider/);
  await assert.rejects(
    () => build({ listScopeEntities: async () => null }),
    (error: unknown) => error instanceof BadRequestException,
  );
  const empty = await build({ listScopeEntities: async () => [] });
  assert.deepEqual(empty.items, []);
});

function reRankerReturning(payload: unknown): SecurityEvaluationIntelReRanker {
  const resolver = {
    resolve: async () => ({ modelId: "stub-model", complete: async () => ({ text: JSON.stringify(payload) }) }),
  } as unknown as ChatModelResolver;
  return new SecurityEvaluationIntelReRanker(resolver);
}

test("the re-ranker compares entity labels case-insensitively", async () => {
  const verdict = await reRankerReturning({
    entityMatches: [{ entity: "next.js", matched: true, evidence: "mentions next.js" }],
    semanticMatch: true,
    finalRelevant: true,
    reason: "the version range covers the entity",
  }).reRank({ title: "advisory" }, [{ value: "Next.js" }]);

  assert.equal(verdict.kind, "relevant");
  assert.equal(verdict.finalRelevant, true);
});

test("the re-ranker treats entities outside the input profile as unavailable, not not-relevant", async () => {
  const verdict = await reRankerReturning({
    entityMatches: [{ entity: "unknown-vendor", matched: true, evidence: null }],
    semanticMatch: false,
    finalRelevant: true,
    reason: "matched unknown-vendor",
  }).reRank({ title: "advisory" }, [{ value: "Next.js" }]);

  assert.equal(verdict.kind, "unavailable");
});

test("unavailable verdicts are never cached and leave the candidate unexamined", async () => {
  const { port, recorded } = stubNegativeCache();
  const service = new SecurityEvaluationIntelMatchService(
    port,
    stubReRanker({ kind: "unavailable", finalRelevant: false, reason: "LLM call failed." }),
  );

  const outcome = await service.match(
    [{ knowledgeItemId: "kn-1", title: "advisory", severity: "high", signalTags: [] }],
    [{ value: "next" }],
    SCOPE_KEY,
  );

  assert.equal(recorded.length, 0);
  assert.deepEqual(outcome.examinedRefs, []);
});

test("the re-rank request signature is content-addressed over the exact model input", () => {
  const item = { title: "advisory", summary: "affects next@<14" };
  const entities: SecurityEvaluationScopeEntity[] = [{ value: "next" }, { value: "webpack" }];
  const base = buildSecurityEvaluationIntelReRankRequest(item, entities, "model-a");

  assert.equal(base.signature, buildSecurityEvaluationIntelReRankRequest(item, entities, "model-a").signature);
  assert.notEqual(
    base.signature,
    buildSecurityEvaluationIntelReRankRequest({ title: "advisory", summary: "affects other" }, entities, "model-a")
      .signature,
  );
  assert.notEqual(base.signature, buildSecurityEvaluationIntelReRankRequest(item, entities, "model-b").signature);
  assert.notEqual(
    base.signature,
    buildSecurityEvaluationIntelReRankRequest(item, [...entities].reverse(), "model-a").signature,
  );
  assert.notEqual(
    base.signature,
    buildSecurityEvaluationIntelReRankRequest(
      item,
      [{ value: "next", context: "web" }, { value: "webpack" }],
      "model-a",
    ).signature,
  );
  assert.deepEqual(base.messages[1], {
    role: "user",
    content: JSON.stringify({
      item: { title: "advisory", summary: "affects next@<14" },
      entities: [
        { value: "next", context: null },
        { value: "webpack", context: null },
      ],
    }),
  });
});

const TTL_DAYS_KEY = "modules.security-evaluation.ttlDays";

function configReturning(ttlDays: unknown): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === TTL_DAYS_KEY) return ttlDays;
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

test("the verdict cache TTL comes from the declared config and never falls back (ADR-033)", () => {
  const prisma = {} as unknown as PrismaService;
  assert.throws(
    () => new SecurityEvaluationIntelNegativeCacheRepository(prisma, configReturning(undefined)),
    new RegExp(TTL_DAYS_KEY),
  );
  assert.throws(
    () => new SecurityEvaluationIntelNegativeCacheRepository(prisma, configReturning(0)),
    /positive integer/,
  );
  assert.throws(
    () => new SecurityEvaluationIntelNegativeCacheRepository(prisma, configReturning(-1)),
    /positive integer/,
  );
  assert.throws(
    () => new SecurityEvaluationIntelNegativeCacheRepository(prisma, configReturning(2.5)),
    /positive integer/,
  );
  assert.doesNotThrow(() => new SecurityEvaluationIntelNegativeCacheRepository(prisma, configReturning(7)));
});

test("the verdict cache reuses only rows recorded under the current signature", async () => {
  const repository = new SecurityEvaluationIntelNegativeCacheRepository(
    {
      securityEvaluationThreatVerdictCache: {
        findMany: async () => [
          { knowledgeItemId: "same", inputSignature: "sig" },
          { knowledgeItemId: "changed", inputSignature: "old" },
          { knowledgeItemId: "legacy", inputSignature: null },
        ],
      },
    } as unknown as PrismaService,
    configReturning(7),
  );

  const uncached = await repository.filterUncached(SCOPE_KEY, [
    { knowledgeItemId: "same", signature: "sig" },
    { knowledgeItemId: "changed", signature: "new" },
    { knowledgeItemId: "legacy", signature: "sig" },
    { knowledgeItemId: "missing", signature: "sig" },
  ]);

  assert.deepEqual(uncached, ["changed", "legacy", "missing"]);
});
