/**
 * Prompt contract of the work-evaluation judgment port (ADR-024) — pure
 * functions with zero runtime dependencies so the contract is testable in the
 * registry without a Nest container, a database or a live model.
 *
 * Vocabulary follows the evaluation skeleton (ADR-020): the model judges
 * criteria, never "dimensions". Only SCORED criteria are presented — verdicts
 * are their product.
 */

/** Bump whenever the prompt contract changes; stored on every judgment. */
export const WORK_EVALUATION_PROMPT_VERSION = "work-evaluation/v1";

/** Default llm-module scope a judgment resolves its chat model from. */
export const DEFAULT_WORK_EVALUATION_SCOPE = "work-evaluation";

export interface WorkEvaluationPhaseBudget {
  advocate: number;
  skeptic: number;
  synthesis: number;
}

export const DEFAULT_WORK_EVALUATION_PHASE_BUDGET: WorkEvaluationPhaseBudget = {
  advocate: 60_000,
  skeptic: 60_000,
  synthesis: 90_000,
};

/** Wall-clock ceiling per phase — tool loops must not run unbounded. */
export const WORK_EVALUATION_PHASE_TIMEOUT_MS: WorkEvaluationPhaseBudget = {
  advocate: 180_000,
  skeptic: 180_000,
  synthesis: 240_000,
};

/** Tool round ceiling per phase — the backstop when the provider omits usage. */
export const WORK_EVALUATION_MAX_TOOL_ROUNDS = 12;

// --- prompt input shapes ---------------------------------------------------

/**
 * One SCORED criterion as the prompt presents it (metadata keys decoded).
 * Mirrors the skeleton's EvaluationCriterionRef — which carries no description
 * column — so the anchors and calibration material live in `metadata`.
 */
export interface WorkEvaluationCriterionPromptInput {
  criterionKey: string;
  name: string;
  /** Skeleton criterion metadata: anchors and calibration material. */
  metadata?: Record<string, unknown> | null;
}

/** Version-level metadata the prompt decodes (ADR-024). */
export interface WorkEvaluationVersionPromptMetadata {
  floorRules?: unknown;
  companyDirectionStatement?: string;
}

/** Manifest entry as rendered into the system prompt (payload never included). */
export interface WorkEvaluationManifestPromptEntry {
  id: string;
  layer: string;
  source: string;
  summary: string;
  observedAt: Date | string;
}

export interface WorkEvaluationPromptInput {
  blindSubjectId: string;
  criteria: WorkEvaluationCriterionPromptInput[];
  homeCriteria: string[];
  versionMetadata: WorkEvaluationVersionPromptMetadata;
  coverageStats: unknown;
  manifest: WorkEvaluationManifestPromptEntry[];
}

// --- prompts ---------------------------------------------------------------

export function buildSystemPrompt(input: WorkEvaluationPromptInput): string {
  const criteria = input.criteria
    .map((criterion) => {
      const metadata = criterion.metadata ?? {};
      const anchors = [
        typeof metadata.anchorLow === "number" ? `band ${metadata.anchorLow}` : null,
        typeof metadata.anchorHigh === "number" ? `to ${metadata.anchorHigh}` : null,
        typeof metadata.fullLoadBaseRef === "string" ? `reference: ${metadata.fullLoadBaseRef}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      const calibration = metadata.calibrationExamples
        ? `\n  calibration examples: ${JSON.stringify(metadata.calibrationExamples)}`
        : "";
      return `- ${criterion.criterionKey} (${criterion.name})${anchors ? `: ${anchors}` : ""}${calibration}`;
    })
    .join("\n");

  return [
    "You are an engineering evaluator. You evaluate one person's actual work over one period, using only the evidence base built for this run.",
    `The person is presented as ${input.blindSubjectId}. You do not know, and must not infer, their name, level, tenure or reporting line.`,
    "",
    "Evidence layers:",
    "- fact: platform API records (commits, pull requests, reviews, incidents). Strong evidence; can support conclusions.",
    "- declared: member-machine artifacts (agent sessions, declared documents). Context and leads only; a claim resting only on declared evidence is weak by definition.",
    "",
    "Rules that are not negotiable:",
    "1. Every conclusion cites evidence ids from the manifest or records returned by tools.",
    "2. Missing evidence is never a low score. If coverage is zero, say 'not connected (coverage 0)' and set confidence low.",
    "3. You may only call the provided read-only tools. Nothing you do changes the evidence.",
    "4. There is deliberately no composite score. Judge criteria independently; the summary states your judgment without compressing it to one number.",
    "5. Budget is finite. What you did not read, list as skipped — do not silently omit it.",
    "",
    "Criteria to judge:",
    criteria,
    "",
    `Home-ground declaration (specialty circle): ${input.homeCriteria.length > 0 ? input.homeCriteria.join(", ") : "not declared"}`,
    "",
    "Company direction statement:",
    input.versionMetadata.companyDirectionStatement ?? "(none declared for this criteria version)",
    "",
    "Floor rules from the criteria version. Report every breach the evidence shows as a risk, with the evidence id; never apply them mechanically — a human decides:",
    input.versionMetadata.floorRules != null
      ? JSON.stringify(input.versionMetadata.floorRules)
      : "none defined for this criteria version.",
    "",
    `Evidence coverage (deterministic, built before you ran): ${JSON.stringify(input.coverageStats)}`,
    "",
    `Evidence manifest (ids, layers, sources; drill in with tools): ${JSON.stringify(
      input.manifest.slice(0, 400).map((entry) => ({
        id: entry.id,
        layer: entry.layer,
        source: entry.source,
        summary: entry.summary,
        observedAt: entry.observedAt,
      })),
    )}${input.manifest.length > 400 ? ` (+${input.manifest.length - 400} more entries)` : ""}`,
    "",
    "Scores use a 0–100 scale per criterion, but they are judgments with stated confidence and coverage — not measurements.",
  ].join("\n");
}

export function buildAdvocateInstruction(): string {
  return [
    "Phase: ADVOCATE.",
    "Find the strongest supportable highlights in the evidence: what did this person actually produce, where did judgment show, where did AI collaboration change the outcome.",
    "For each highlight name the evidence ids you relied on and say what the evidence does NOT establish.",
    "Be concrete. Do not compliment; cite.",
  ].join("\n");
}

export function buildSkepticInstruction(advocateText: string): string {
  return [
    "Phase: SKEPTIC.",
    "Attack the evidence base. Where is coverage thin? Which claims have no fact-layer counterpart? Which declared-layer artifacts cannot be corroborated?",
    "List every concern as a numbered challenge that synthesis must answer individually.",
    `Advocate's case to attack:\n${advocateText || "(advocate produced no text)"}`,
  ].join("\n");
}

export function buildSynthesisInstruction(input: {
  criteria: WorkEvaluationCriterionPromptInput[];
  advocateText: string;
  skepticText: string;
}): string {
  return [
    "Phase: SYNTHESIS.",
    "Judge each criterion independently. Do not let an overall impression carry across criteria.",
    "Answer every skeptic challenge below one by one; anything you cannot answer must be listed in `unresolved`.",
    "If a criterion's coverage is zero or thin, say so and set confidence accordingly — never convert missing evidence into a low score.",
    "Do not produce a composite score.",
    "",
    "ADVOCATE:",
    input.advocateText || "(none)",
    "",
    "SKEPTIC:",
    input.skepticText || "(none)",
    "",
    "Return ONLY a JSON object with this shape:",
    JSON.stringify({
      verdicts: [
        {
          criterionKey: "<criterion key>",
          score: 0,
          confidence: "high|medium|low",
          coverage: { included: 0, skipped: 0, note: "<what you read and what you did not>" },
          evidenceRefs: ["<manifest evidence ids>"],
          rationale: "<why, grounded in cited evidence>",
          unresolved: ["<optional: what would change your mind>"],
        },
      ],
      summary: "<one paragraph, no composite score>",
      unresolved: [{ challenge: "", response: "" }],
      skipped: [{ what: "", reason: "" }],
    }),
  ].join("\n");
}

// --- output parsing --------------------------------------------------------

export interface ParsedWorkEvaluationVerdict {
  criterionKey: string;
  score: number;
  confidence: "high" | "medium" | "low";
  coverage: { included: number; skipped: number; note?: string };
  evidenceRefs: string[];
  rationale: string;
  unresolved?: string[];
}

export interface ParsedWorkEvaluationJudgment {
  verdicts: ParsedWorkEvaluationVerdict[];
  summary: string;
  /** Skeptic challenges the synthesis could not answer. */
  unresolved: { challenge: string; response: string }[];
  /** Material the model reports as not read: [{ what, reason }]. */
  skipped: { what: string; reason: string }[];
}

/**
 * Parses the synthesis JSON. A criterion the model did not answer simply
 * produces no verdict — deliberately unlike the old people-evaluation parser,
 * which backfilled a zero-score placeholder. The skeleton verdict has no
 * `evaluated` flag, so a placeholder 0 would be indistinguishable from a real
 * judgment of 0; absence is the honest signal.
 */
export function parseJudgmentOutput(
  text: string,
  criteria: WorkEvaluationCriterionPromptInput[],
): ParsedWorkEvaluationJudgment {
  const json = extractJson(text);
  if (!json) {
    throw new Error("Evaluation synthesis did not return parseable JSON.");
  }

  const rawVerdicts = Array.isArray(json.verdicts) ? json.verdicts : [];
  const known = new Set(criteria.map((criterion) => criterion.criterionKey));
  const verdicts: ParsedWorkEvaluationVerdict[] = [];

  for (const raw of rawVerdicts) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const criterionKey = String(record.criterionKey ?? "");
    if (!known.has(criterionKey)) continue;
    const score = Number(record.score);
    if (!Number.isFinite(score)) continue;

    const coverage = (record.coverage ?? {}) as Record<string, unknown>;
    const confidence = String(record.confidence ?? "low");
    const unresolved = record.unresolved;
    verdicts.push({
      criterionKey,
      score: Math.min(100, Math.max(0, score)),
      confidence: confidence === "high" || confidence === "medium" ? confidence : "low",
      coverage: {
        included: Number(coverage.included ?? 0),
        skipped: Number(coverage.skipped ?? 0),
        ...(coverage.note ? { note: String(coverage.note) } : {}),
      },
      evidenceRefs: Array.isArray(record.evidenceRefs) ? record.evidenceRefs.map(String) : [],
      rationale: String(record.rationale ?? ""),
      unresolved: Array.isArray(unresolved) ? unresolved.map(String) : unresolved ? [String(unresolved)] : undefined,
    });
  }

  const summary = String(json.summary ?? "").trim();
  if (!summary) {
    throw new Error("Evaluation synthesis returned an empty summary.");
  }

  return {
    verdicts,
    summary,
    unresolved: asObjectArray(json.unresolved).map((item) => ({
      challenge: String((item as Record<string, unknown>).challenge ?? ""),
      response: String((item as Record<string, unknown>).response ?? ""),
    })),
    skipped: asObjectArray(json.skipped).map((item) => ({
      what: String((item as Record<string, unknown>).what ?? ""),
      reason: String((item as Record<string, unknown>).reason ?? ""),
    })),
  };
}

function asObjectArray(value: unknown): object[] {
  return Array.isArray(value) ? value.filter((item): item is object => !!item && typeof item === "object") : [];
}

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
