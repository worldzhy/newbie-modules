import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAdvocateInstruction,
  buildSkepticInstruction,
  buildSynthesisInstruction,
  buildSystemPrompt,
  DEFAULT_WORK_EVALUATION_PHASE_BUDGET,
  DEFAULT_WORK_EVALUATION_SCOPE,
  parseJudgmentOutput,
  WORK_EVALUATION_MAX_TOOL_ROUNDS,
  WORK_EVALUATION_PHASE_TIMEOUT_MS,
  WORK_EVALUATION_PROMPT_VERSION,
  type WorkEvaluationCriterionPromptInput,
  type WorkEvaluationManifestPromptEntry,
  type WorkEvaluationPromptInput,
} from "./work-evaluation-judgment.prompt";

/**
 * Prompt contract tests (ADR-024): the prompt is the only place anchors,
 * calibration material and the blind-subject framing are fixed, and the parser
 * is where the "no placeholder verdict" rule lives. Pure functions, no
 * database, no model.
 */

const CRITERIA: WorkEvaluationCriterionPromptInput[] = [
  {
    criterionKey: "output-quality",
    name: "Output quality",
    metadata: {
      anchorLow: 20,
      anchorHigh: 90,
      fullLoadBaseRef: "staff engineer baseline",
      calibrationExamples: [{ score: 85, note: "shipped the migration alone" }],
    },
  },
  { criterionKey: "ai-collaboration", name: "AI collaboration" },
];

function manifestEntries(count: number): WorkEvaluationManifestPromptEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`,
    layer: "declared",
    source: "session",
    summary: `session ${index + 1}`,
    observedAt: "2026-10-01T00:00:00.000Z",
  }));
}

function promptInput(overrides: Partial<WorkEvaluationPromptInput> = {}): WorkEvaluationPromptInput {
  return {
    blindSubjectId: "subject-7f3a9c",
    criteria: CRITERIA,
    homeCriteria: ["output-quality"],
    versionMetadata: {
      floorRules: [{ rule: "no force pushes to main" }],
      companyDirectionStatement: "Ship reliably, then ship fast.",
    },
    coverageStats: { evaluated: { total: 2 } },
    manifest: manifestEntries(2),
    ...overrides,
  };
}

describe("prompt constants", () => {
  it("pins the version, scope, budgets and ceilings the runner relies on", () => {
    assert.equal(WORK_EVALUATION_PROMPT_VERSION, "work-evaluation/v1");
    assert.equal(DEFAULT_WORK_EVALUATION_SCOPE, "work-evaluation");
    assert.deepEqual(DEFAULT_WORK_EVALUATION_PHASE_BUDGET, {
      advocate: 60_000,
      skeptic: 60_000,
      synthesis: 90_000,
    });
    assert.deepEqual(WORK_EVALUATION_PHASE_TIMEOUT_MS, {
      advocate: 180_000,
      skeptic: 180_000,
      synthesis: 240_000,
    });
    assert.equal(WORK_EVALUATION_MAX_TOOL_ROUNDS, 12);
  });
});

describe("buildSystemPrompt", () => {
  it("renders anchors and calibration examples from criterion metadata", () => {
    const prompt = buildSystemPrompt(promptInput());

    assert.ok(prompt.includes("- output-quality (Output quality): band 20; to 90; reference: staff engineer baseline"));
    assert.ok(prompt.includes('calibration examples: [{"score":85,"note":"shipped the migration alone"}]'));
  });

  it("renders a criterion with no metadata as a bare entry — no dangling colon or calibration line", () => {
    const prompt = buildSystemPrompt(promptInput());

    assert.ok(prompt.includes("- ai-collaboration (AI collaboration)\n"));
    assert.ok(!prompt.includes("- ai-collaboration (AI collaboration):"));
  });

  it("renders partial anchors without inventing the missing parts", () => {
    const prompt = buildSystemPrompt(
      promptInput({
        criteria: [{ criterionKey: "scope", name: "Scope", metadata: { anchorLow: 10 } }],
      }),
    );

    assert.ok(prompt.includes("- scope (Scope): band 10\n"));
    assert.ok(!prompt.includes("to 90"));
    assert.ok(!prompt.includes("reference:"));
  });

  it("keeps the blind-subject framing and the declared home-ground circle", () => {
    const prompt = buildSystemPrompt(promptInput());

    assert.ok(prompt.includes("presented as subject-7f3a9c"));
    assert.ok(prompt.includes("must not infer"));
    assert.ok(prompt.includes("Home-ground declaration (specialty circle): output-quality"));
  });

  it("states 'not declared' when no home-ground circle exists and '(none declared)' without a direction statement", () => {
    const prompt = buildSystemPrompt(promptInput({ homeCriteria: [], versionMetadata: {} }));

    assert.ok(prompt.includes("Home-ground declaration (specialty circle): not declared"));
    assert.ok(prompt.includes("(none declared for this criteria version)"));
    assert.ok(prompt.includes("none defined for this criteria version."));
  });

  it("caps the rendered manifest at 400 entries and reports the remainder", () => {
    const manifest = manifestEntries(401);
    const prompt = buildSystemPrompt(promptInput({ manifest }));

    assert.ok(prompt.includes('"id":"e400"'));
    assert.ok(!prompt.includes('"id":"e401"'));
    assert.ok(prompt.includes("(+1 more entries)"));
  });

  it("renders a manifest of exactly 400 entries with no remainder note", () => {
    const prompt = buildSystemPrompt(promptInput({ manifest: manifestEntries(400) }));

    assert.ok(prompt.includes('"id":"e400"'));
    assert.ok(!prompt.includes("more entries"));
  });
});

describe("phase instructions", () => {
  it("names the advocate phase and demands citations over compliments", () => {
    const instruction = buildAdvocateInstruction();

    assert.ok(instruction.includes("Phase: ADVOCATE."));
    assert.ok(instruction.includes("evidence ids"));
  });

  it("embeds the advocate text for the skeptic, with an explicit fallback", () => {
    assert.ok(buildSkepticInstruction("the case").includes("Advocate's case to attack:\nthe case"));
    assert.ok(buildSkepticInstruction("").includes("(advocate produced no text)"));
  });

  it("lists the criteria and demands per-criterion judgment without a composite score", () => {
    const instruction = buildSynthesisInstruction({ criteria: CRITERIA, advocateText: "a", skepticText: "s" });

    assert.ok(instruction.includes("Phase: SYNTHESIS."));
    assert.ok(instruction.includes("Do not produce a composite score."));
    assert.ok(instruction.includes('"verdicts"'));
    assert.ok(instruction.includes('"summary"'));
  });
});

describe("parseJudgmentOutput", () => {
  const CRITERIA_KEYS = ["output-quality", "ai-collaboration", "scope"].map((criterionKey) => ({
    criterionKey,
    name: criterionKey,
  }));

  it("parses a fenced verdict payload, clamps scores and normalizes confidence and unresolved", () => {
    const text = [
      "Here is my judgment:",
      "```json",
      JSON.stringify({
        verdicts: [
          {
            criterionKey: "output-quality",
            score: 145,
            confidence: "high",
            coverage: { included: 5, skipped: 1, note: "read everything but e9" },
            evidenceRefs: ["e1", "e2"],
            rationale: "strong delivery",
            unresolved: "would change with incident data",
          },
          {
            criterionKey: "ai-collaboration",
            score: -12,
            confidence: "certain",
            coverage: { included: 2 },
            evidenceRefs: "e3",
            rationale: 42,
            unresolved: [7, "needs more sessions"],
          },
        ],
        summary: "  Solid period with gaps in corroboration.  ",
        unresolved: [{ challenge: "no fact-layer link", response: "acknowledged, kept low confidence" }],
        skipped: [{ what: "e9", reason: "budget" }],
      }),
      "```",
    ].join("\n");

    const parsed = parseJudgmentOutput(text, CRITERIA_KEYS);

    assert.equal(parsed.verdicts.length, 2);

    const [first, second] = parsed.verdicts;
    assert.equal(first.criterionKey, "output-quality");
    assert.equal(first.score, 100);
    assert.equal(first.confidence, "high");
    assert.deepEqual(first.coverage, { included: 5, skipped: 1, note: "read everything but e9" });
    assert.deepEqual(first.evidenceRefs, ["e1", "e2"]);
    assert.equal(first.rationale, "strong delivery");
    assert.deepEqual(first.unresolved, ["would change with incident data"]);

    assert.equal(second.score, 0);
    assert.equal(second.confidence, "low");
    assert.deepEqual(second.coverage, { included: 2, skipped: 0 });
    assert.deepEqual(second.evidenceRefs, []);
    assert.equal(second.rationale, "42");
    assert.deepEqual(second.unresolved, ["7", "needs more sessions"]);

    assert.equal(parsed.summary, "Solid period with gaps in corroboration.");
    assert.deepEqual(parsed.unresolved, [
      { challenge: "no fact-layer link", response: "acknowledged, kept low confidence" },
    ]);
    assert.deepEqual(parsed.skipped, [{ what: "e9", reason: "budget" }]);
  });

  it("produces no placeholder verdict for a criterion the model did not answer", () => {
    const text = JSON.stringify({
      verdicts: [
        {
          criterionKey: "output-quality",
          score: 70,
          confidence: "medium",
          coverage: { included: 3, skipped: 0 },
          evidenceRefs: ["e1"],
          rationale: "answered",
        },
      ],
      summary: "Only one criterion judged.",
    });

    const parsed = parseJudgmentOutput(text, CRITERIA_KEYS);

    // Three criteria went in, one verdict came out: absence is the honest
    // signal — a backfilled 0 would be indistinguishable from a judged 0.
    assert.equal(parsed.verdicts.length, 1);
    assert.deepEqual(
      parsed.verdicts.map((verdict) => verdict.criterionKey),
      ["output-quality"],
    );
  });

  it("drops verdicts for unknown criteria and verdicts without a finite score", () => {
    const text = JSON.stringify({
      verdicts: [
        { criterionKey: "hallucinated-criterion", score: 50, rationale: "not ours" },
        { criterionKey: "scope", score: "not-a-number", rationale: "no score" },
        { criterionKey: "scope", score: 60, confidence: "medium", rationale: "the real one" },
      ],
      summary: "One real verdict.",
    });

    const parsed = parseJudgmentOutput(text, CRITERIA_KEYS);

    assert.deepEqual(
      parsed.verdicts.map((verdict) => [verdict.criterionKey, verdict.score]),
      [["scope", 60]],
    );
  });

  it("rejects a missing or empty summary", () => {
    for (const summary of [undefined, "", "   "]) {
      const text = JSON.stringify({ verdicts: [], ...(summary === undefined ? {} : { summary }) });
      assert.throws(() => parseJudgmentOutput(text, CRITERIA_KEYS), /empty summary/);
    }
  });

  it("rejects text that carries no parseable JSON object", () => {
    assert.throws(
      () => parseJudgmentOutput("the model apologized and returned prose", CRITERIA_KEYS),
      /parseable JSON/,
    );
    assert.throws(() => parseJudgmentOutput("", CRITERIA_KEYS), /parseable JSON/);
    assert.throws(() => parseJudgmentOutput("{ not json }", CRITERIA_KEYS), /parseable JSON/);
  });
});
