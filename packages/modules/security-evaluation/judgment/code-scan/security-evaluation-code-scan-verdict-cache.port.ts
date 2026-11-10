import type { EvaluationFindingSeverity } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * Bipolar verdict-cache port for CODE_SCAN LLM judgment (ADR-054 clause 6).
 *
 * Positive AND negative per-file verdicts are cached — a deliberate departure
 * from the INTEL negative cache (ADR-045), which stores only "not-relevant"
 * because a feed item is one-shot. A source file persists across runs:
 * replaying the cached verdict for an unchanged file keeps finding identities
 * deterministic (no OPEN→RESOLVED flapping from LLM nondeterminism), bounds
 * the daily cost, and lets a file skipped by a later run's budget still
 * "reappear" via its cached verdict instead of being reaped as absent.
 *
 * `unavailable` verdicts are never written. Rows older than the declared
 * codeScanVerdictCacheTtlDays are treated as misses.
 *
 * The write side belongs to the judgment layer; the port keeps Prisma out of
 * `judgment/` (the directory is statically enforced infrastructure-free).
 */
export const securityEvaluationCodeScanVerdictCacheToken = "SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE";

/** One structured finding entry as cached (evidenceRefs are re-attached on replay). */
export interface SecurityEvaluationCodeScanCachedFinding {
  criterionKey: string;
  severity: EvaluationFindingSeverity;
  title: string;
  detail: string;
  symbol: string | null;
  rationale: string;
}

/**
 * One cache row: the per-criterion slice of one call's verdict, keyed by the
 * full judgment identity (ADR-054 clause 6). A per-file call writes one row
 * per criterion of the ruleset, all sharing `signature`.
 */
export interface SecurityEvaluationCodeScanVerdictCacheEntry {
  subjectId: string;
  criterionKey: string;
  path: string;
  contentHash: string;
  modelId: string;
  /** ConnectionScope.id of the LLM that produced this verdict. Nullable for rows written before the column existed. */
  connectionId?: string | null;
  promptVersion: string;
  ruleSetVersion: string;
  /** The call's findings for THIS criterion (empty when the call found none). */
  findings: SecurityEvaluationCodeScanCachedFinding[];
  /** Content address of the request that produced this verdict. */
  signature: string;
}

export interface SecurityEvaluationCodeScanVerdictLookup {
  subjectId: string;
  modelId: string;
  /** ConnectionScope.id to disambiguate connections that happen to share a modelId. */
  connectionId?: string | null;
  promptVersion: string;
  ruleSetVersion: string;
  files: readonly { path: string; contentHash: string }[];
}

export interface SecurityEvaluationCodeScanVerdictCachePort {
  /**
   * Cached per-criterion verdict rows for the given files, restricted to the
   * exact judgment identity (model, prompt version, ruleset version) and
   * within TTL. Keyed by `codeScanVerdictCacheKey(path, contentHash)`; a file
   * with no fresh row is absent from the map.
   */
  lookup(
    input: SecurityEvaluationCodeScanVerdictLookup,
  ): Promise<Map<string, SecurityEvaluationCodeScanVerdictCacheEntry[]>>;
  /** Upsert the per-criterion rows of one call. Never called for unavailable verdicts. */
  record(entries: readonly SecurityEvaluationCodeScanVerdictCacheEntry[]): Promise<void>;
}

/** Map key joining the two freshness dimensions of a cached file verdict. */
export function codeScanVerdictCacheKey(path: string, contentHash: string): string {
  return `${path}\u0000${contentHash}`;
}
