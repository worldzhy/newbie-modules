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
import {
  SecurityEvaluationCodeScanExcerptService,
  type SecurityEvaluationCodeScanExcerptInput,
} from "./evidence/security-evaluation-code-scan-excerpt.service";
import { SecurityEvaluationRetentionService } from "./security-evaluation-retention.service";
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
  SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET,
  SECURITY_EVALUATION_KEY_CODE_SCAN,
} from "./security-evaluation.constants";

/**
 * Behavior-level tests for CODE_SCAN (ADR-054): finding fingerprints stay
 * stable across content edits, cached verdicts replay byte-identically,
 * skipped files are accounted with ids and reasons, out-of-range model output
 * is discarded, unavailable verdicts are never cached, and a run that judges
 * no file at all fails instead of recording a vacuous clean result.
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
  // The excerpt is not part of the manifest any more (ADR-054 clause 7): the
  // judgment reads it from the retention-bounded store, so the fixture has to
  // seed that store with the same content hash.
  FIXTURE_EXCERPTS.set(codeScanContentHash(content), content);
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
      truncated: false,
    },
  };
}

const FIXTURE_EXCERPTS = new Map<string, string>();

function stubExcerptStore(seed: ReadonlyMap<string, string> = new Map()) {
  const rows = new Map(seed);
  const saved: SecurityEvaluationCodeScanExcerptInput[] = [];
  const store = {
    save: async (_subjectId: string, excerpts: readonly SecurityEvaluationCodeScanExcerptInput[]) => {
      for (const excerpt of excerpts) {
        saved.push({ ...excerpt });
        rows.set(excerpt.contentHash, excerpt.excerpt);
      }
    },
    load: async (_subjectId: string, contentHashes: readonly string[]) =>
      new Map(contentHashes.filter((hash) => rows.has(hash)).map((hash) => [hash, rows.get(hash) as string] as const)),
    pruneExpired: async () => ({ deleted: 0 }),
  } as unknown as SecurityEvaluationCodeScanExcerptService;
  return { store, saved, rows };
}

function codeScanExcerpts(): SecurityEvaluationCodeScanExcerptService {
  return stubExcerptStore(FIXTURE_EXCERPTS).store;
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

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
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

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
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

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
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

test("code-scan mechanism never caches an unavailable verdict (partial: one malformed file, one judged)", async () => {
  const judged = codeScanItem("src/a.ts", "const a = 1;");
  const malformed = codeScanItem("src/b.ts", "const b = 2;");
  const cache = stubCache();
  const { resolver } = stubResolver((call) =>
    call.messages.some((message) => message.content?.includes("src/b.ts"))
      ? "this is not json"
      : JSON.stringify({ findings: [] }),
  );

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  const judgment = await mechanism.judge(judgmentInput([judged, malformed]));

  assert.deepEqual(judgment.evaluatedRefs, [judged.id]);
  assert.deepEqual(
    cache.recorded[0].map((row) => row.path),
    CRITERIA.map(() => "src/a.ts"),
  );
  assert.equal(judgment.skipped?.total, 1);
  assert.deepEqual(judgment.skipped?.items, [malformed.id]);
  assert.ok(judgment.skipped?.note?.includes("unavailable"));
});

test("code-scan mechanism fails the run when every file verdict is unavailable", async () => {
  const items = [codeScanItem("src/a.ts", "const a = 1;"), codeScanItem("src/b.ts", "const b = 2;")];
  const cache = stubCache();
  const { resolver } = stubResolver(() => "this is not json");

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  await assert.rejects(() => mechanism.judge(judgmentInput(items)), /unavailable for all 2 file/);
  assert.equal(cache.recorded.length, 0);
});

test("code-scan mechanism fails the run when the LLM scope is unbound (no vacuous clean run)", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const resolver = { resolve: async () => Promise.reject(new Error("no model bound")) } as unknown as ChatModelResolver;

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  await assert.rejects(() => mechanism.judge(judgmentInput([item])), /unresolvable/);
  assert.equal(cache.recorded.length, 0);
});

test("code-scan mechanism ignores other evaluationKeys", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const { resolver, calls } = stubResolver(() => "{}");
  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  const input = judgmentInput([item]);
  const judgment = await mechanism.judge({
    ...input,
    ruleSetVersion: { ...input.ruleSetVersion, evaluationKey: "npm-osv" },
  });
  assert.deepEqual(judgment.evaluatedRefs, []);
  assert.equal(calls.length, 0);
});

test("code-scan mechanism budget-cuts files when the LLM_CALL_BUDGET (now 180, below MAX_FILES=200) is exceeded (round31 R31-09)", async () => {
  // BUDGET is lowered to 180 (down from 200) so files 181-200 are budget-cut
  // when all sourceItems are uncached — making the branch reachable with
  // large repositories instead of being dead code as before the fix.
  const items = Array.from({ length: SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET + 2 }, (_, i) =>
    codeScanItem(`src/file${i}.ts`, `const x${i} = ${i};`),
  );
  const cache = stubCache();
  const { resolver } = stubResolver(() => JSON.stringify({ findings: [] }));

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  const judgment = await mechanism.judge(judgmentInput(items));

  assert.equal(judgment.evaluatedRefs.length, SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET);
  assert.equal(judgment.skipped?.total, 2);
  assert.ok(judgment.skipped?.note?.includes("over the per-run LLM call budget"));
  assert.equal(judgment.metadata?.llmCalls, SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET);
  assert.equal(cache.recorded.length, SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET);
});

test("code-scan mechanism reports discarded-entry note even when no file was skipped (round31 R31-07)", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  // model returns one entry with a criterionKey that is not in our criteria
  const { resolver } = stubResolver(() =>
    JSON.stringify({
      findings: [
        {
          criterionKey: "unknown",
          severity: "MEDIUM",
          title: "t",
          detail: "d",
          rationale: "r",
          symbol: null,
          evidenceRefs: ["whatever"],
        },
      ],
    }),
  );

  const mechanism = new SecurityEvaluationCodeScanMechanism(resolver, cache.port, codeScanExcerpts());
  const judgment = await mechanism.judge(judgmentInput([item]));

  // The file was evaluated, just the model's single entry was discarded
  assert.equal(judgment.evaluatedRefs.length, 1);
  assert.equal(judgment.findings.length, 0);
  // R31-07 fix: skipped is still defined because there's a note about discarded entries
  assert.ok(judgment.skipped !== undefined, "skipped should not be undefined when there are discard reasons");
  assert.equal(judgment.skipped?.total, 0, "no file id was skipped");
  assert.ok(judgment.skipped?.note?.includes("discarded"));
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

function codeScanEvidenceProvider(
  excerpts: SecurityEvaluationCodeScanExcerptService,
  snapshotAccess?: RepositorySnapshotAccess,
): SecurityEvaluationEvidenceProvider {
  return new SecurityEvaluationEvidenceProvider(
    {} as PrismaService,
    { getOrCreateAsset: async () => ({ id: "asset-1" }) } as unknown as SecurityEvaluationAssetService,
    {} as SecurityEvaluationIntelNegativeCachePort,
    excerpts,
    undefined,
    undefined,
    undefined,
    snapshotAccess,
  );
}

test("code-scan evidence registers every readable file and accounts host-skipped and read-failed files", async () => {
  const provider = codeScanEvidenceProvider(
    codeScanExcerpts(),
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
    () => codeScanEvidenceProvider(codeScanExcerpts(), undefined).collect(SUBJECT, CODE_SCAN_VERSION),
    /SECURITY_EVALUATION_REPOSITORY_SNAPSHOT_ACCESS/,
  );

  const emptyListing = codeScanEvidenceProvider(codeScanExcerpts(), stubSnapshotAccess({ entries: [] }));
  await assert.rejects(() => emptyListing.collect(SUBJECT, CODE_SCAN_VERSION), BadRequestException);

  const allReadFailed = codeScanEvidenceProvider(
    codeScanExcerpts(),
    stubSnapshotAccess({ entries: [{ path: "src/a.ts", sizeBytes: 1 }], readFail: ["src/a.ts"] }),
  );
  await assert.rejects(() => allReadFailed.collect(SUBJECT, CODE_SCAN_VERSION), BadRequestException);
});

test("code-scan manifest keeps hash and truncated flag but never the source excerpt", async () => {
  const big = "x".repeat(SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS + 500);
  const { store, saved } = stubExcerptStore();
  const provider = codeScanEvidenceProvider(store, {
    list: async () => ({ revision: "abc123", entries: [{ path: "src/big.ts", sizeBytes: big.length }], skipped: [] }),
    read: async () => new Map([["src/big.ts", big]]),
  });

  const collection = await provider.collect(SUBJECT, CODE_SCAN_VERSION);
  const payload = collection.items[0].payload as { excerpt?: string; truncated: boolean; contentHash: string };
  assert.equal(payload.truncated, true);
  // The archived manifest is immutable, so source code must not land in it.
  assert.equal(payload.excerpt, undefined);
  assert.equal(payload.contentHash, codeScanContentHash(big));

  // The excerpt that the judgment reads lives in the retention-bounded store.
  assert.equal(saved.length, 1);
  assert.equal(saved[0].contentHash, codeScanContentHash(big));
  assert.equal(saved[0].excerpt.length, SECURITY_EVALUATION_CODE_SCAN_EXCERPT_MAX_CHARS);
  assert.notEqual(saved[0].contentHash, codeScanContentHash(saved[0].excerpt));
});

// --- Excerpt retention & physical deletion (ADR-054 clauses 6/7, R33-01) -----------

test("code-scan mechanism refuses to judge a file whose retained excerpt is gone", async () => {
  const item = codeScanItem("src/a.ts", "const a = 1;");
  const cache = stubCache();
  const { resolver, calls } = stubResolver(() => JSON.stringify({ findings: [] }));

  const mechanism = new SecurityEvaluationCodeScanMechanism(
    resolver,
    cache.port,
    stubExcerptStore().store, // empty store: the excerpt has been pruned
  );

  await assert.rejects(() => mechanism.judge(judgmentInput([item])), /no retained excerpt/);
  assert.equal(calls.length, 0);
  assert.equal(cache.recorded.length, 0);
});

test("retention physically deletes expired verdict-cache rows and excerpts", async () => {
  const cutoffs: Date[] = [];
  const prisma = {
    securityEvaluationCodeScanVerdictCache: {
      deleteMany: async (args: { where: { updatedAt: { lt: Date } } }) => {
        cutoffs.push(args.where.updatedAt.lt);
        return { count: 2 };
      },
    },
    securityEvaluationCodeScanFileExcerpt: {
      deleteMany: async (args: { where: { updatedAt: { lt: Date } } }) => {
        cutoffs.push(args.where.updatedAt.lt);
        return { count: 3 };
      },
    },
  } as unknown as PrismaService;
  const retention = new SecurityEvaluationRetentionService(
    new SecurityEvaluationCodeScanVerdictCacheRepository(prisma, {
      getOrThrow: () => "30",
    } as unknown as ConfigService),
    new SecurityEvaluationCodeScanExcerptService(prisma),
  );

  assert.deepEqual(await retention.pruneExpired(), { verdictCacheDeleted: 2, excerptsDeleted: 3 });

  const now = Date.now();
  const [verdictAgeDays, excerptAgeDays] = cutoffs.map((cutoff) => (now - cutoff.getTime()) / 86_400_000);
  assert.ok(verdictAgeDays > 29 && verdictAgeDays < 31, `verdict cutoff was ${verdictAgeDays} days`);
  assert.ok(excerptAgeDays > 89 && excerptAgeDays < 91, `excerpt cutoff was ${excerptAgeDays} days`);
});

test("retained-excerpt reads apply the retention window between prune runs", async () => {
  const now = Date.now();
  const stored = [
    { contentHash: "fresh", excerpt: "fresh code", updatedAt: new Date(now - 86_400_000) },
    { contentHash: "expired", excerpt: "expired code", updatedAt: new Date(now - 120 * 86_400_000) },
  ];
  let queriedCutoff: Date | undefined;
  const prisma = {
    securityEvaluationCodeScanFileExcerpt: {
      findMany: async (args: { where: { updatedAt: { gte: Date } } }) => {
        queriedCutoff = args.where.updatedAt.gte;
        return stored
          .filter((row) => row.updatedAt >= queriedCutoff!)
          .map(({ contentHash, excerpt }) => ({ contentHash, excerpt }));
      },
    },
  } as unknown as PrismaService;
  const excerpts = new SecurityEvaluationCodeScanExcerptService(prisma);

  const loaded = await excerpts.load(SUBJECT.id, ["fresh", "expired"]);

  assert.deepEqual([...loaded.keys()], ["fresh"]);
  const readAgeDays = (now - (queriedCutoff as Date).getTime()) / 86_400_000;
  assert.ok(readAgeDays > 89 && readAgeDays < 91, `read cutoff was ${readAgeDays} days`);
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
