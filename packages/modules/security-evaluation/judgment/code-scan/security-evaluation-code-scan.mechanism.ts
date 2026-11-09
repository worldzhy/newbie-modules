import { Inject, Injectable, Logger } from "@nestjs/common";
import { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import type { ChatModelPort } from "@modules/llm/chat-model.port";
import type {
  EvaluationEvidenceItem,
  EvaluationFindingCandidate,
  EvaluationFindingSeverity,
} from "@modules/evaluation/ports/evaluation.contracts";
import type { EvaluationJudgment, JudgmentInput } from "@modules/evaluation/ports/judgment.port";

import {
  SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET,
  SECURITY_EVALUATION_KEY_CODE_SCAN,
} from "../../security-evaluation.constants";
import {
  SECURITY_EVALUATION_MECHANISM_NAME_CODE_LLM,
  type SecurityEvaluationJudgmentMechanism,
} from "../security-evaluation-mechanism";
import { codeScanFingerprint } from "./security-evaluation-code-scan.identity";
import {
  buildSecurityEvaluationCodeScanRequest,
  codeScanPromptVersion,
  SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE,
  type SecurityEvaluationCodeScanCriterionBrief,
  type SecurityEvaluationCodeScanFilePayload,
} from "./security-evaluation-code-scan-request";
import {
  codeScanVerdictCacheKey,
  securityEvaluationCodeScanVerdictCacheToken,
  type SecurityEvaluationCodeScanCachedFinding,
  type SecurityEvaluationCodeScanVerdictCachePort,
} from "./security-evaluation-code-scan-verdict-cache.port";

const CODE_SCAN_SEVERITIES: ReadonlySet<string> = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

/** Payload fields the evidence collector attaches to every CODE_SCAN manifest item. */
interface CodeScanEvidencePayload {
  path: string;
  language?: string;
  bytes: number;
  revision: string;
  contentHash: string;
  excerpt: string;
  truncated: boolean;
}

/** One finding entry of the LLM response after per-entry schema validation. */
interface CodeScanLlmFinding {
  criterionKey: string;
  severity: EvaluationFindingSeverity;
  title: string;
  detail: string;
  evidenceRefs: string[];
  symbol: string | null;
  rationale: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Parse the whole LLM response. Throws when the top level is not strict JSON
 * of the declared shape — the file then counts as an unavailable verdict and
 * is never cached (intel discipline: "fail schema validation and the pair is
 * marked invalid"). Individual entries failing validation are NOT thrown
 * here; the caller discards them one by one so one hallucinated entry cannot
 * sink the file's other findings.
 */
function parseCodeScanResponse(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("LLM verdict is not a JSON object");
  }
  const parsed: unknown = JSON.parse(trimmed);
  const record = asRecord(parsed);
  if (!record || !Array.isArray(record.findings)) {
    throw new Error("LLM verdict must be an object with a findings array");
  }
  return record.findings as unknown[];
}

/**
 * Validate one response entry. Returns null when the entry must be discarded:
 * unknown criterionKey, a severity outside the enum, missing text fields, or
 * an evidenceRef pointing anywhere but the judged file's manifest item —
 * out-of-range references are dropped, never smuggled through (ADR-054
 * clause 2).
 */
function toValidFinding(
  raw: unknown,
  evidenceId: string,
  criteriaKeys: ReadonlySet<string>,
): CodeScanLlmFinding | null {
  const record = asRecord(raw);
  if (!record) return null;
  const criterionKey = asNonEmptyString(record.criterionKey);
  if (!criterionKey || !criteriaKeys.has(criterionKey)) return null;
  const severity = asNonEmptyString(record.severity);
  if (!severity || !CODE_SCAN_SEVERITIES.has(severity)) return null;
  const title = asNonEmptyString(record.title);
  const detail = asNonEmptyString(record.detail);
  const rationale = asNonEmptyString(record.rationale);
  if (!title || !detail || !rationale) return null;
  const symbol = asNullableString(record.symbol);
  if (symbol === undefined) return null;
  if (!Array.isArray(record.evidenceRefs)) return null;
  const evidenceRefs = record.evidenceRefs as unknown[];
  if (evidenceRefs.length === 0 || !evidenceRefs.every((ref) => ref === evidenceId)) return null;
  return {
    criterionKey,
    severity: severity as EvaluationFindingSeverity,
    title,
    detail,
    evidenceRefs: [evidenceId],
    symbol,
    rationale,
  };
}

/**
 * CODE_LLM judgment mechanism (ADR-054): every source file of the pinned
 * repository snapshot is judged by one LLM call per file against the five
 * risk-category criteria.
 *
 * Caching discipline (clause 6): before calling the model, the mechanism
 * replays cached verdicts for files whose full judgment identity matches
 * (subject, criteria set, path, content hash, model, prompt version, ruleset
 * version, within TTL) — a hit replays positive AND negative verdicts, so an
 * unchanged file's findings reappear byte-identically and never flap. Only a
 * complete row set (one row per criterion) counts as a hit. Unavailable
 * verdicts (unbound model, call failure, malformed response) are never
 * cached; the file lands in the skipped bucket instead.
 */
@Injectable()
export class SecurityEvaluationCodeScanMechanism implements SecurityEvaluationJudgmentMechanism {
  readonly name = SECURITY_EVALUATION_MECHANISM_NAME_CODE_LLM;
  private readonly logger = new Logger(SecurityEvaluationCodeScanMechanism.name);

  constructor(
    private readonly resolver: ChatModelResolver,
    @Inject(securityEvaluationCodeScanVerdictCacheToken)
    private readonly verdictCache: SecurityEvaluationCodeScanVerdictCachePort,
  ) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    if (input.ruleSetVersion.evaluationKey !== SECURITY_EVALUATION_KEY_CODE_SCAN) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }
    const sourceItems = input.evidence.filter((item) => item.layer === "source" && item.source === "repository");
    if (sourceItems.length === 0) {
      return { verdicts: [], findings: [], evaluatedRefs: [] };
    }

    const criteria = input.criteria;
    const criteriaKeys = new Set(criteria.map((criterion) => criterion.criterionKey));
    const criteriaBriefs: SecurityEvaluationCodeScanCriterionBrief[] = criteria.map((criterion) => {
      const metadata = asRecord(criterion.metadata);
      return {
        criterionKey: criterion.criterionKey,
        name: criterion.name,
        description: asNonEmptyString(metadata?.description) ?? undefined,
        severityGuidance: asNonEmptyString(metadata?.severityGuidance) ?? undefined,
      };
    });
    const promptVersion = codeScanPromptVersion();
    const ruleSetVersion = input.ruleSetVersion.version;

    let chatModel: ChatModelPort | null = null;
    try {
      chatModel = await this.resolver.resolve(SECURITY_EVALUATION_CODE_SCAN_LLM_SCOPE);
    } catch (error) {
      this.logger.warn(`CODE_SCAN LLM scope unresolvable; every file is an unavailable verdict: ${String(error)}`);
    }
    const modelId = chatModel?.modelId ?? null;

    const payloads = new Map<string, CodeScanEvidencePayload>();
    for (const item of sourceItems) {
      const payload = asRecord(item.payload);
      const path = asNonEmptyString(payload?.path);
      const excerpt = typeof payload?.excerpt === "string" ? payload.excerpt : null;
      const contentHash = asNonEmptyString(payload?.contentHash);
      if (!path || excerpt === null || !contentHash) {
        throw new Error(`CODE_SCAN evidence item ${item.id} is missing path/excerpt/contentHash payload fields`);
      }
      payloads.set(item.id, {
        path,
        language: asNonEmptyString(payload?.language) ?? undefined,
        bytes: typeof payload?.bytes === "number" ? payload.bytes : excerpt.length,
        revision: asNonEmptyString(payload?.revision) ?? "unknown",
        contentHash,
        excerpt,
        truncated: payload?.truncated === true,
      });
    }
    const revision = payloads.get(sourceItems[0].id)?.revision ?? "unknown";

    const cached = modelId
      ? await this.verdictCache.lookup({
          subjectId: input.subject.id,
          modelId,
          promptVersion,
          ruleSetVersion,
          files: sourceItems.map((item) => {
            const payload = payloads.get(item.id)!;
            return { path: payload.path, contentHash: payload.contentHash };
          }),
        })
      : new Map<string, never[]>();

    const findings: EvaluationFindingCandidate[] = [];
    const evaluatedRefs: string[] = [];
    const skippedIds: string[] = [];
    const skippedReasons: string[] = [];
    const requestSignatures: string[] = [];
    const seenFingerprints = new Set<string>();
    let llmCalls = 0;
    let cacheHits = 0;
    let unavailableCount = 0;
    let budgetCutCount = 0;
    let discardedEntries = 0;
    let duplicateEntries = 0;

    const pushFinding = (
      cachedFinding: SecurityEvaluationCodeScanCachedFinding,
      item: EvaluationEvidenceItem,
      payload: CodeScanEvidencePayload,
    ) => {
      const fingerprint = codeScanFingerprint(cachedFinding.criterionKey, payload.path, cachedFinding.symbol);
      if (seenFingerprints.has(fingerprint)) {
        duplicateEntries++;
        return;
      }
      seenFingerprints.add(fingerprint);
      findings.push({
        criterionKey: cachedFinding.criterionKey,
        fingerprint,
        severity: cachedFinding.severity,
        title: cachedFinding.title,
        detail: cachedFinding.detail,
        evidenceRefs: [item.id],
        metadata: {
          path: payload.path,
          contentHash: payload.contentHash,
          ...(cachedFinding.symbol ? { symbol: cachedFinding.symbol } : {}),
          rationale: cachedFinding.rationale,
        },
      });
    };

    for (const item of sourceItems) {
      const payload = payloads.get(item.id)!;
      const cachedRows = cached.get(codeScanVerdictCacheKey(payload.path, payload.contentHash));
      if (cachedRows && cachedRows.length === criteria.length) {
        cacheHits++;
        evaluatedRefs.push(item.id);
        for (const row of cachedRows) {
          for (const cachedFinding of row.findings) pushFinding(cachedFinding, item, payload);
        }
        continue;
      }

      if (!chatModel || !modelId) {
        unavailableCount++;
        skippedIds.push(item.id);
        continue;
      }
      if (llmCalls >= SECURITY_EVALUATION_CODE_SCAN_LLM_CALL_BUDGET) {
        budgetCutCount++;
        skippedIds.push(item.id);
        continue;
      }
      llmCalls++;

      const filePayload: SecurityEvaluationCodeScanFilePayload = {
        evidenceId: item.id,
        path: payload.path,
        language: payload.language,
        excerpt: payload.excerpt,
        truncated: payload.truncated,
      };
      const request = buildSecurityEvaluationCodeScanRequest(filePayload, criteriaBriefs, modelId);

      let rawFindings: unknown[];
      try {
        const result = await chatModel.complete({
          messages: request.messages,
          responseFormat: request.responseFormat,
          temperature: request.temperature,
        });
        rawFindings = parseCodeScanResponse(result.text);
      } catch (error) {
        // Unavailable verdicts are never cached: a later run with a healthy
        // model or a parseable response must re-judge the file.
        unavailableCount++;
        skippedIds.push(item.id);
        this.logger.warn(`CODE_SCAN judgment for ${payload.path} unavailable; not cached: ${String(error)}`);
        continue;
      }
      requestSignatures.push(request.signature);

      const valid: CodeScanLlmFinding[] = [];
      for (const raw of rawFindings) {
        const finding = toValidFinding(raw, item.id, criteriaKeys);
        if (!finding) {
          discardedEntries++;
          continue;
        }
        valid.push(finding);
      }

      const byCriterion = new Map<string, SecurityEvaluationCodeScanCachedFinding[]>();
      for (const criterion of criteria) byCriterion.set(criterion.criterionKey, []);
      for (const finding of valid) {
        byCriterion.get(finding.criterionKey)!.push({
          criterionKey: finding.criterionKey,
          severity: finding.severity,
          title: finding.title,
          detail: finding.detail,
          symbol: finding.symbol,
          rationale: finding.rationale,
        });
      }
      try {
        await this.verdictCache.record(
          criteria.map((criterion) => ({
            subjectId: input.subject.id,
            criterionKey: criterion.criterionKey,
            path: payload.path,
            contentHash: payload.contentHash,
            modelId,
            promptVersion,
            ruleSetVersion,
            findings: byCriterion.get(criterion.criterionKey)!,
            signature: request.signature,
          })),
        );
      } catch (error) {
        // A cache write failure must not sink the run: the verdict is already
        // computed; the next run simply re-judges the file.
        this.logger.warn(`CODE_SCAN verdict cache write failed for ${payload.path}: ${String(error)}`);
      }

      evaluatedRefs.push(item.id);
      for (const finding of valid) pushFinding(finding, item, payload);
    }

    if (unavailableCount > 0)
      skippedReasons.push(
        `${unavailableCount} file(s) not judged: the LLM call was unavailable or the response malformed`,
      );
    if (budgetCutCount > 0) skippedReasons.push(`${budgetCutCount} file(s) over the per-run LLM call budget`);
    if (discardedEntries > 0)
      skippedReasons.push(
        `${discardedEntries} finding entrie(s) discarded: unknown criterion or out-of-range evidenceRef`,
      );

    return {
      verdicts: [],
      findings,
      evaluatedRefs,
      skipped:
        skippedIds.length > 0
          ? { total: skippedIds.length, items: skippedIds, note: skippedReasons.join("; ") }
          : undefined,
      summary: `Code scan judged ${evaluatedRefs.length} file(s) at revision ${revision}: ${findings.length} finding(s), ${cacheHits} cache hit(s), ${llmCalls} LLM call(s).`,
      metadata: {
        modelId: modelId ?? "unbound",
        promptVersion,
        temperature: 0,
        revision,
        llmCalls,
        cacheHits,
        discardedEntries,
        duplicateEntries,
        requestSignatures,
      },
    };
  }
}
