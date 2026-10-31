import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { EvaluationRuleSetVersionRef, EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import { SecurityEvaluationIntelJudgment } from "./judgment/intel/security-evaluation-intel.judgment";
import { SecurityEvaluationIntelMatchService } from "./judgment/intel/security-evaluation-intel-match.service";
import type { SecurityEvaluationIntelReRanker } from "./judgment/intel/security-evaluation-intel-re-ranker";
import type { SecurityEvaluationScopeEntitiesProvider } from "./judgment/intel/security-evaluation-scope-entities.port";
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
  scopeType: "project",
  scopeId: "22222222-2222-4222-8222-222222222222",
  subjectKey: "application-1",
  displayName: "nightwatch-backend",
};

const INTEL_VERSION: EvaluationRuleSetVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "repository",
  evaluationKey: "threat-intel",
  version: "v1",
};

const SCOPE_KEY = `${SUBJECT.scopeType}:${SUBJECT.scopeId}`;

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

function stubPrisma(rows: IntelRow[]) {
  const updatedIds: string[] = [];
  const prisma = {
    securityEvaluationThreatKnowledgeItem: {
      findMany: async () => rows,
      findUnique: async () => ({ negativeCache: null }),
      update: async ({ where }: { where: { id: string } }) => {
        updatedIds.push(where.id);
        return {};
      },
    },
  } as unknown as PrismaService;
  return { prisma, updatedIds };
}

const SCOPE_PROVIDER: SecurityEvaluationScopeEntitiesProvider = {
  listScopeEntities: async () => [
    {
      scopeType: SUBJECT.scopeType,
      scopeId: SUBJECT.scopeId,
      entities: [{ value: "next" }, { value: "nightwatch-backend" }],
    },
  ],
};

function stubAssets(): SecurityEvaluationAssetService {
  return {
    ensureAsset: async () => ({ id: "asset-1" }),
  } as unknown as SecurityEvaluationAssetService;
}

function stubReRanker(
  verdict: { finalRelevant: boolean; kind: "relevant" | "not-relevant" | "unavailable"; reason: string },
  entity = "next",
): SecurityEvaluationIntelReRanker {
  return {
    reRank: async () => ({
      kind: verdict.kind,
      entityMatches: [{ entity, matched: verdict.finalRelevant, evidence: null }],
      semanticMatch: false,
      finalRelevant: verdict.finalRelevant,
      reason: verdict.reason,
    }),
  } as unknown as SecurityEvaluationIntelReRanker;
}

function buildEvidence(prisma: PrismaService) {
  return new SecurityEvaluationEvidenceProvider(prisma, stubAssets(), undefined, SCOPE_PROVIDER).collect(
    SUBJECT,
    INTEL_VERSION,
  );
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
  const { prisma } = stubPrisma([
    row("kn-1", { title: "Next.js advisory", severity: "high" }),
    row("kn-2", { negativeCache: { [SCOPE_KEY]: "not relevant" } }),
  ]);

  const evidence = await buildEvidence(prisma);
  const knowledge = evidence.items.filter((item) => item.layer === "knowledge");
  assert.deepEqual(
    knowledge.map((item) => [item.id, item.source, item.summary, item.refs]),
    [["threat-knowledge:kn-1", "ghsa", "Next.js advisory", ["kn-1"]]],
  );
  assert.equal(knowledge[0].payload?.knowledgeItemId, "kn-1");
  assert.equal(knowledge[0].payload?.severity, "high");
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

  const { prisma } = stubPrisma(rows);
  const evidence = await buildEvidence(prisma);

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
  const { prisma, updatedIds } = stubPrisma(rows);
  const evidence = await buildEvidence(prisma);
  const matchService = new SecurityEvaluationIntelMatchService(
    prisma,
    stubReRanker({ kind: "not-relevant", finalRelevant: false, reason: "No entity impact." }),
  );
  const judgment = new SecurityEvaluationIntelJudgment(matchService);

  const result = await judgment.judge(judgmentInput(evidence.items));

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].metadata?.knowledgeItemId, "hard");
  assert.deepEqual(result.evaluatedRefs, ["threat-knowledge:hard", "threat-knowledge:not-relevant"]);
  assert.equal(result.skipped, undefined);
  assert.deepEqual(result.metadata, { matchedCount: 1, scopeEntities: 2 });
  assert.deepEqual(updatedIds, ["not-relevant"]);
});

test("the re-rank budget leaves overflow candidates in the judgment skipped bucket", async () => {
  const rows = Array.from({ length: SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET + 2 }, (_, index) =>
    row(`rerank-${index}`, { title: `advisory ${index}`, severity: "high" }),
  );
  const { prisma, updatedIds } = stubPrisma(rows);
  const evidence = await buildEvidence(prisma);
  const matchService = new SecurityEvaluationIntelMatchService(
    prisma,
    stubReRanker({ kind: "not-relevant", finalRelevant: false, reason: "No entity impact." }),
  );
  const judgment = new SecurityEvaluationIntelJudgment(matchService);

  const result = await judgment.judge(judgmentInput(evidence.items));

  assert.equal(result.evaluatedRefs.length, SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET);
  assert.equal(result.skipped?.total, 2);
  assert.deepEqual(result.skipped?.items, ["threat-knowledge:rerank-100", "threat-knowledge:rerank-101"]);
  assert.match(result.skipped?.note ?? "", new RegExp(`budget of ${SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET}`));
  assert.equal(updatedIds.length, SECURITY_EVALUATION_INTEL_RE_RANK_BUDGET);
});
