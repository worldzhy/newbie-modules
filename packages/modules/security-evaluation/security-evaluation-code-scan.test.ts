import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import type { ChatModelPort } from "@modules/llm/chat-model.port";
import type { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import type {
  EvaluationCriterionRef,
  EvaluationEvidenceItem,
  EvaluationRuleSetVersionRef,
  EvaluationSubjectRef,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import {
  codeScanContentHash,
  codeScanEvidenceId,
  codeScanFingerprint,
  codeScanLanguage,
} from "./judgment/code-scan/security-evaluation-code-scan.identity";
import { SecurityEvaluationCodeScanMechanism } from "./judgment/code-scan/security-evaluation-code-scan.mechanism";
import {
  buildSecurityEvaluationCodeScanRequest,
  codeScanPromptVersion,
  SECURITY_EVALUATION_CODE_SCAN_SYSTEM_PROMPT,
} from "./judgment/code-scan/security-evaluation-code-scan-request";
import {
  codeScanVerdictCacheKey,
  type SecurityEvaluationCodeScanCachedFinding,
  type SecurityEvaluationCodeScanVerdictCacheEntry,
  type SecurityEvaluationCodeScanVerdictCachePort,
} from "./judgment/code-scan/security-evaluation-code-scan-verdict-cache.port";
import type { SecurityEvaluationIntelNegativeCachePort } from "./judgment/intel/security-evaluation-intel-negative-cache.port";
import type { RepositorySnapshotAccess } from "./ports/repository-snapshot-access.port";
import { SecurityEvaluationCodeScanVerdictCacheRepository } from "./persistence/security-evaluation-code-scan-verdict-cache.repository";
import {
  SECURITY_EVALUATION_CODE_SCAN_CRITERION_KEYS,
  SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS,
  SECURITY_EVALUATION_KEY_CODE_SCAN,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for CODE_SCAN (ADR-054): finding fingerprints stay
 * stable across content edits, cached verdicts replay byte-identically,
 * skipped files are accounted with ids and reasons, out-of-range model output
 * is discarded, and unavailable verdicts are never cached.
 */

const SUBJECT: EvaluationSubjectRef = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "repository",
  scopeType: "project",
  scopeId: "22222222-2222-4222-8222-222222222222",
  subjectKey: "application-1",
  displayName: "nightwatch-backend",
};

const CODE_SCAN_VERSION: EvaluationRuleSetVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "repository",
  evaluationKey: SECURITY_EVALUATION_KEY_CODE_SCAN,
  version: "v1",
};

const CRITERIA: EvaluationCriterionRef[] = SECURITY_EVALUATION_CODE_SCAN_CRITERION_KEYS.map((criterionKey) => ({
  criterionKey,
  kind: "ASSERTION",
  name: criterionKey,
  metadata: { severityGuidance: "MEDIUM" },
}));

function codeScanItem(path: string, content: string): EvaluationEvidenceItem {
  return {
    id: codeScanEvidenceId(path),
    layer: "source",
    source: "repository",
    summary: path,
    observedAt: new Date("2026-11-10T00:00:00.000Z"),
    refs: ["abc123"],
    payload: {
      path,
      language: codeScanLanguage(path),
      bytes: content.length,
      revision: "abc123",
      contentHash: codeScanContentHash(content),
      excerpt: content,
      truncated: false,
    },
  };
}

function judgmentInput(evidence: EvaluationEvidenceItem[]): JudgmentInput {
  const { kind: _kind, ...subject } = SUBJECT;
  return { subject, ruleSetVersion: CODE_SCAN_VERSION, criteria: CRITERIA, evidence, runConfig: null };
}

interface CompleteCall {
  messages: { role: string; content: string }[];
}

function stubResolver(respond: (call: CompleteCall) => string): { resolver: ChatModelResolver; calls: CompleteCall[] } {
  const calls: CompleteCall[] = [];
  const model = {
    modelId: "test-model",
    complete: async (input: CompleteCall) => {
      calls.push(input);
      return { text: respond(input), toolCalls: [], finishReason: "stop" };
    },
  } as unknown as ChatModelPort;
  const resolver = { resolve: async () => model } as unknown as ChatModelResolver;
  return { resolver, calls };
}

function stubCache(rows: SecurityEvaluationCodeScanVerdictCacheEntry[] = []) {
  const recorded: SecurityEvaluationCodeScanVerdictCacheEntry[][] = [];
  const port: SecurityEvaluationCodeScanVerdictCachePort = {
    lookup: async () => {
      const grouped = new Map<string, SecurityEvaluationCodeScanVerdictCacheEntry[]>();
      for (const row of rows) {
        const key = codeScanVerdictCacheKey(row.path, row.contentHash);
        grouped.set(key, [...(grouped.get(key) ?? []), row]);
      }
      return grouped;
    },
    record: async (entries) => {
      recorded.push([...entries]);
    },
  };
  return { port, recorded };
}

function cacheRowsFor(
  item: EvaluationEvidenceItem,
  findings: SecurityEvaluationCodeScanCachedFinding[],
): SecurityEvaluationCodeScanVerdictCacheEntry[] {
  const payload = item.payload as { path: string; contentHash: string };
  return CRITERIA.map((criterion) => ({
    subjectId: SUBJECT.id,
    criterionKey: criterion.criterionKey,
    path: payload.path,
    contentHash: payload.contentHash,
    modelId: "test-model",
    promptVersion: codeScanPromptVersion(),
    ruleSetVersion: "v1",
    findings: findings.filter((finding) => finding.criterionKey === criterion.criterionKey),
    signature: "sig-cached",
  }));
}

// --- Identity (ADR-054 clause 5) ------------------------------------------------

test("code-scan fingerprint ignores content and line numbers but keeps criterion, path and symbol", () => {
  const base = codeScanFingerprint("code-scan.injection", "src/app.ts", "handler");
  // Content edits of the same finding site must not change the identity —
  // otherwise a human suppression would be lost with the old fingerprint.
  assert.equal(codeScanFingerprint("code-scan.injection", "src/app.ts", "handler"), base);
  assert.equal(
    codeScanFingerprint("code-scan.injection", "src/app.ts"),
    codeScanFingerprint("code-scan.injection", "src/app.ts", null),
  );
  assert.notEqual(codeScanFingerprint("code-scan.crypto-misuse", "src/app.ts", "handler"), base);
  assert.notEqual(codeScanFingerprint("code-scan.injection", "src/other.ts", "handler"), base);
  assert.notEqual(codeScanFingerprint("code-scan.injection", "src/app.ts", "otherHandler"), base);
});

test("code-scan evidence id and language derive from the repository-relative path", () => {
  assert.equal(codeScanEvidenceId("src/a.ts"), "code-scan:src/a.ts");
  assert.equal(codeScanLanguage("src/a.ts"), "typescript");
  assert.equal(codeScanLanguage("script.py"), "python");
  assert.equal(codeScanLanguage("README"), undefined);
});

// --- Request signature & prompt version (ADR-054 clauses 6/8, ADR-045 discipline) ---

test("code-scan request signature is byte-identical for identical input and moves with model or content", () => {
  const file = {
    evidenceId: "code-scan:src/a.ts",
    path: "src/a.ts",
    language: "typescript",
    excerpt: "const a = 1;",
    truncated: false,
  };
  const criteria = [{ criterionKey: "code-scan.injection", name: "Injection sink" }];
  const first = buildSecurityEvaluationCodeScanRequest(file, criteria, "model-a");
  const second = buildSecurityEvaluationCodeScanRequest(file, criteria, "model-a");
  assert.equal(first.signature, second.signature);
  assert.notEqual(buildSecurityEvaluationCodeScanRequest(file, criteria, "model-b").signature, first.signature);
  assert.notEqual(
    buildSecurityEvaluationCodeScanRequest({ ...file, excerpt: "const a = 2;" }, criteria, "model-a").signature,
    first.signature,
  );
});

test("code-scan prompt version hashes the system prompt bytes, so a prompt edit invalidates cached verdicts", () => {
  const expected = createHash("sha256").update(SECURITY_EVALUATION_CODE_SCAN_SYSTEM_PROMPT, "utf8").digest("hex");
  assert.equal(codeScanPromptVersion(), expected);
});

// --- Mechanism: cache replay (ADR-054 clause 6) ----------------------------------

test("code-scan mechanism replays a complete cached verdict set without calling the LLM", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cachedFinding: SecurityEvaluationCodeScanCachedFinding = {
    criterionKey: "code-scan.secret-exposure",
    severity: "HIGH",
    title: "Hardcoded token",
    detail: "A token literal is assigned.",
    symbol: null,
    rationale: "Anyone with repo read access obtains the token.",
  };
  const cache = stubCache(cacheRowsFor(item, [cachedFinding]));
  const { resolver, calls } = stubResolver(() => {
    throw new Error("LLM must not be called on a cache hit");
  });

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const judgment = await mechanism.judge(judgmentInput([item]));

  assert.equal(calls.length, 0);
  assert.equal(cache.recorded.length, 0);
  assert.deepEqual(judgment.evaluatedRefs, [item.id]);
  assert.equal(judgment.findings.length, 1);
  assert.equal(judgment.findings[0].criterionKey, "code-scan.secret-exposure");
  // evidenceRefs are re-attached on replay so a cached verdict can never
  // smuggle a stale manifest id into a new run.
  assert.deepEqual(judgment.findings[0].evidenceRefs, [item.id]);
  assert.equal(judgment.findings[0].fingerprint, codeScanFingerprint("code-scan.secret-exposure", "src/a.ts", null));
  assert.equal(judgment.skipped, undefined);
  const metadata = judgment.metadata as { cacheHits: number; llmCalls: number };
  assert.equal(metadata.cacheHits, 1);
  assert.equal(metadata.llmCalls, 0);
});

test("code-scan mechanism treats a partial cached row set as a miss and re-judges", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const rows = cacheRowsFor(item, []).slice(0, CRITERIA.length - 1);
  const cache = stubCache(rows);
  const { resolver, calls } = stubResolver(() => JSON.stringify({ findings: [] }));

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const judgment = await mechanism.judge(judgmentInput([item]));

  assert.equal(calls.length, 1);
  assert.deepEqual(judgment.evaluatedRefs, [item.id]);
  assert.equal(cache.recorded.length, 1);
  assert.equal(cache.recorded[0].length, CRITERIA.length);
});

// --- Mechanism: fresh judgment, validation and cache write (ADR-054 clauses 2/6) ---

test("code-scan mechanism discards out-of-range entries and caches per-criterion rows", async () => {
  const item = codeScanItem("src/db.ts", "db.query(`SELECT * FROM u WHERE id=${id}`);");
  const response = {
    findings: [
      {
        criterionKey: "code-scan.injection",
        severity: "HIGH",
        title: "SQL string concatenation",
        detail: "User-controlled id reaches a raw query.",
        evidenceRefs: [item.id],
        symbol: "findUser",
        rationale: "An attacker can alter the query logic.",
      },
      {
        criterionKey: "code-scan.not-a-category",
        severity: "LOW",
        title: "hallucinated category",
        detail: "x",
        evidenceRefs: [item.id],
        symbol: null,
        rationale: "y",
      },
      {
        criterionKey: "code-scan.crypto-misuse",
        severity: "MEDIUM",
        title: "points at another file",
        detail: "x",
        evidenceRefs: ["code-scan:src/other.ts"],
        symbol: null,
        rationale: "y",
      },
    ],
  };
  const cache = stubCache();
  const { resolver } = stubResolver(() => JSON.stringify(response));

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const judgment = await mechanism.judge(judgmentInput([item]));

  assert.equal(judgment.findings.length, 1);
  assert.equal(judgment.findings[0].criterionKey, "code-scan.injection");
  assert.equal(judgment.findings[0].fingerprint, codeScanFingerprint("code-scan.injection", "src/db.ts", "findUser"));
  assert.deepEqual(judgment.evaluatedRefs, [item.id]);
  const metadata = judgment.metadata as { discardedEntries: number; llmCalls: number; modelId: string };
  assert.equal(metadata.discardedEntries, 2);
  assert.equal(metadata.llmCalls, 1);
  assert.equal(metadata.modelId, "test-model");

  // One cache write for the call: one row per criterion of the ruleset, the
  // injection row carries the finding, the rest carry empty arrays (bipolar:
  // the negative outcome is cached too).
  assert.equal(cache.recorded.length, 1);
  const rows = cache.recorded[0];
  assert.equal(rows.length, CRITERIA.length);
  const injectionRow = rows.find((row) => row.criterionKey === "code-scan.injection");
  assert.equal(injectionRow?.findings.length, 1);
  assert.equal(injectionRow?.findings[0].symbol, "findUser");
  for (const row of rows) {
    assert.equal(row.modelId, "test-model");
    assert.equal(row.promptVersion, codeScanPromptVersion());
    assert.equal(row.ruleSetVersion, "v1");
    assert.ok(row.signature.length > 0);
  }
});

test("code-scan mechanism never caches an unavailable verdict (malformed response)", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const { resolver } = stubResolver(() => "this is not json");

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const judgment = await mechanism.judge(judgmentInput([item]));

  assert.deepEqual(judgment.evaluatedRefs, []);
  assert.equal(judgment.findings.length, 0);
  assert.equal(cache.recorded.length, 0);
  assert.equal(judgment.skipped?.total, 1);
  assert.deepEqual(judgment.skipped?.items, [item.id]);
  assert.ok(judgment.skipped?.note?.includes("unavailable"));
});

test("code-scan mechanism never caches an unavailable verdict (LLM scope unbound)", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const resolver = { resolve: async () => Promise.reject(new Error("no model bound")) } as unknown as ChatModelResolver;

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const judgment = await mechanism.judge(judgmentInput([item]));

  assert.deepEqual(judgment.evaluatedRefs, []);
  assert.equal(cache.recorded.length, 0);
  assert.equal(judgment.skipped?.total, 1);
  assert.deepEqual(judgment.skipped?.items, [item.id]);
});

test("code-scan mechanism ignores other evaluationKeys", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const { resolver, calls } = stubResolver(() => "{}");
  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port);
  const input = judgmentInput([item]);
  const judgment = await mechanism.judge({
    ...input,
    ruleSetVersion: { ...input.ruleSetVersion, evaluationKey: "npm-osv" },
  });
  assert.deepEqual(judgment.evaluatedRefs, []);
  assert.equal(calls.length, 0);
});

// --- Evidence collection (ADR-054 clause 7) --------------------------------------

function stubSnapshotAccess(listing: {
  entries: { path: string; sizeBytes: number }[];
  skipped?: { path: string; reason: string }[];
  readFail?: string[];
}): RepositorySnapshotAccess {
  const readFail = new Set(listing.readFail ?? []);
  return {
    list: async () => ({ revision: "abc123", entries: listing.entries, skipped: listing.skipped ?? [] }),
    read: async (_subject, _revision, paths) => {
      const map = new Map<string, string>();
      for (const path of paths) {
        if (!readFail.has(path)) map.set(path, `// content of ${path}`);
      }
      return map;
    },
  };
}

function codeScanEvidenceProvider(snapshotAccess?: RepositorySnapshotAccess): SecurityEvaluationEvidenceProvider {
  return new SecurityEvaluationEvidenceProvider(
    {} as PrismaService,
    { getOrCreateAsset: async () => ({ id: "asset-1" }) } as unknown as SecurityEvaluationAssetService,
    {} as SecurityEvaluationIntelNegativeCachePort,
    undefined,
    undefined,
    undefined,
    snapshotAccess,
  );
}

test("code-scan evidence registers every readable file and accounts host-skipped and read-failed files", async () => {
  const provider = codeScanEvidenceProvider(
    stubSnapshotAccess({
      entries: [
        { path: "src/a.ts", sizeBytes: 10 },
        { path: "src/b.ts", sizeBytes: 10 },
      ],
      skipped: [{ path: "logo.png", reason: "binary" }],
      readFail: ["src/b.ts"],
    }),
  );

  const collection = await provider.collect(SUBJECT, CODE_SCAN_VERSION);

  assert.equal(collection.items.length, 1);
  assert.equal(collection.items[0].id, "code-scan:src/a.ts");
  assert.equal(collection.items[0].layer, "source");
  assert.deepEqual(collection.items[0].refs, ["abc123"]);
  // unconsumed must be 0: every listed path is either a manifest item or in
  // the skipped bucket, with ids and reasons.
  assert.equal(collection.skipped.total, 2);
  assert.deepEqual(collection.skipped.items?.sort(), ["code-scan:logo.png", "code-scan:src/b.ts"].sort());
  assert.ok(collection.skipped.note?.includes("binary"));
  assert.ok(collection.skipped.note?.includes("could not be read"));
});

test("code-scan evidence fails the run when the snapshot port is unbound or the scan set is empty", async () => {
  await assert.rejects(
    () => codeScanEvidenceProvider(undefined).collect(SUBJECT, CODE_SCAN_VERSION),
    /SECURITY_EVALUATION_REPOSITORY_SNAPSHOT_ACCESS/,
  );

  const emptyListing = codeScanEvidenceProvider(stubSnapshotAccess({ entries: [] }));
  await assert.rejects(() => emptyListing.collect(SUBJECT, CODE_SCAN_VERSION), BadRequestException);

  const allReadFailed = codeScanEvidenceProvider(
    stubSnapshotAccess({ entries: [{ path: "src/a.ts", sizeBytes: 1 }], readFail: ["src/a.ts"] }),
  );
  await assert.rejects(() => allReadFailed.collect(SUBJECT, CODE_SCAN_VERSION), BadRequestException);
});

test("code-scan evidence truncates the excerpt but hashes the full content", async () => {
  const big = "x".repeat(SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS + 500);
  const provider = codeScanEvidenceProvider({
    list: async () => ({ revision: "abc123", entries: [{ path: "src/big.ts", sizeBytes: big.length }], skipped: [] }),
    read: async () => new Map([["src/big.ts", big]]),
  });

  const collection = await provider.collect(SUBJECT, CODE_SCAN_VERSION);
  const payload = collection.items[0].payload as { excerpt: string; truncated: boolean; contentHash: string };
  assert.equal(payload.truncated, true);
  assert.equal(payload.excerpt.length, SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS);
  assert.equal(payload.contentHash, codeScanContentHash(big));
  assert.notEqual(payload.contentHash, codeScanContentHash(payload.excerpt));
});

// --- Verdict cache TTL contract (ADR-033 discipline, ADR-054 clause 6) -------------

test("code-scan verdict cache TTL is declared per environment and never falls back", () => {
  const missing = {
    getOrThrow: () => {
      throw new Error("Config property is undefined");
    },
  } as unknown as ConfigService;
  assert.throws(() => new SecurityEvaluationCodeScanVerdictCacheRepository({} as PrismaService, missing));

  const invalid = { getOrThrow: () => "not-a-number" } as unknown as ConfigService;
  assert.throws(
    () => new SecurityEvaluationCodeScanVerdictCacheRepository({} as PrismaService, invalid),
    /positive integer/,
  );

  const declared = { getOrThrow: () => "30" } as unknown as ConfigService;
  assert.doesNotThrow(() => new SecurityEvaluationCodeScanVerdictCacheRepository({} as PrismaService, declared));
});
