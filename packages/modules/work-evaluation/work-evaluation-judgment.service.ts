import { randomUUID } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";

import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ChatMessage, ChatModelPort, ModelToolCall, ToolSpecification } from "@modules/llm/chat-model.port";
import { ChatModelResolver } from "@modules/llm/chat-model.resolver";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import { EvaluationCoverageBucket, EvaluationVerdict } from "@modules/evaluation/ports/evaluation.contracts";
import { EvaluationJudgment, JudgmentInput, JudgmentPort } from "@modules/evaluation/ports/judgment.port";

import { WorkEvaluationPeriodService } from "./work-evaluation-period.service";
import { createDrillRedactor, redactDeep } from "./work-evaluation-redaction";
import { readBudgetOverride, readScopeOverride, requirePeriodId } from "./work-evaluation-run-config";
import {
  DEFAULT_WORK_EVALUATION_PHASE_BUDGET,
  DEFAULT_WORK_EVALUATION_SCOPE,
  WORK_EVALUATION_MAX_TOOL_ROUNDS,
  WORK_EVALUATION_PHASE_TIMEOUT_MS,
  WORK_EVALUATION_PROMPT_VERSION,
  WorkEvaluationPhaseBudget,
  WorkEvaluationVersionPromptMetadata,
  buildAdvocateInstruction,
  buildSkepticInstruction,
  buildSynthesisInstruction,
  buildSystemPrompt,
  parseJudgmentOutput,
} from "./work-evaluation-judgment.prompt";
import { WorkEvaluationJudgmentRunState, WorkEvaluationJudgmentTools } from "./work-evaluation-judgment.tools";

type PhaseName = keyof WorkEvaluationPhaseBudget;
type PhaseStopReason = "token-budget" | "time-limit" | "tool-round-limit";

interface PhaseResult {
  text: string;
  stopReason?: PhaseStopReason;
}

/**
 * WorkEvaluationJudgmentService — the JudgmentPort for subject kind "work"
 * (ADR-024). A bounded, read-only, three-phase agent: advocate finds support,
 * skeptic attacks it and names evidence gaps, synthesis must answer every
 * challenge on the record. The subject is presented under a blind id so
 * persona and level cannot leak into the judgment.
 *
 * Only SCORED criteria are judged here — ASSERTION criteria produce findings,
 * and this feature's first slice declares none.
 */
@Injectable()
export class WorkEvaluationJudgmentService implements JudgmentPort {
  private readonly logger = new Logger(WorkEvaluationJudgmentService.name);

  constructor(
    private readonly resolver: ChatModelResolver,
    private readonly tools: WorkEvaluationJudgmentTools,
    private readonly prisma: PrismaService,
    private readonly criteriaService: EvaluationCriteriaService,
    private readonly periods: WorkEvaluationPeriodService,
  ) {}

  async judge(input: JudgmentInput): Promise<EvaluationJudgment> {
    // The period is a run-level parameter (ADR-026); the evaluatee is the
    // subject's key, and the identity tokens are resolved live from the
    // account so a renamed member is masked without re-registering subjects.
    const periodId = requirePeriodId(input.runConfig);
    const evaluateeUserId = input.subject.subjectKey;
    const scope = readScopeOverride(input.runConfig) ?? DEFAULT_WORK_EVALUATION_SCOPE;
    const port = await this.resolver.resolve(scope);

    const version = await this.criteriaService.getVersion(input.criteriaVersion.id);
    const versionMetadata = (version.metadata ?? {}) as WorkEvaluationVersionPromptMetadata;

    // Only SCORED criteria produce verdicts; ASSERTION criteria belong to a
    // finding pipeline this feature does not declare yet.
    const criteria = input.criteria.filter((criterion) => criterion.kind === "SCORED");

    const homeCriteria = await this.homeCriteria(evaluateeUserId, periodId);
    const blindSubjectId = `subject-${randomUUID()}`;
    const identityTokens = await this.loadIdentityTokens(evaluateeUserId);
    identityTokens.add(input.subject.displayName);
    const state = this.tools.startRun(identityTokens);

    const budget = { ...DEFAULT_WORK_EVALUATION_PHASE_BUDGET, ...readBudgetOverride(input.runConfig) };
    const tokenUsage = { total: 0, byPhase: {} as Record<string, number> };
    const specifications = this.tools.specifications();
    // The skeleton hands the judgment only the collected items (the coverage
    // buckets are composed after judging), so the prompt's coverage view is
    // computed here from the manifest itself.
    const collectedBySource: Record<string, number> = {};
    for (const item of input.evidence) {
      collectedBySource[item.source] = (collectedBySource[item.source] ?? 0) + 1;
    }
    // Structural invariant: everything the model sees is redacted up front.
    // The drill tools keep their own redactor; the prompt input passes through
    // the same scrubber so no field can leak the subject's identity.
    const redact = createDrillRedactor(identityTokens);
    const promptInput = redactDeep(
      {
        blindSubjectId,
        criteria,
        homeCriteria,
        versionMetadata,
        coverageStats: {
          collected: { total: input.evidence.length, bySource: collectedBySource },
          note: input.evidence.length === 0 ? "no evidence collected for this run" : undefined,
        },
        manifest: input.evidence,
      },
      redact,
    );
    const system = buildSystemPrompt(promptInput);

    const advocate = await this.runPhase({
      state,
      port,
      phase: "advocate",
      budgetTokens: budget.advocate,
      context: { evaluateeUserId, periodId, manifest: input.evidence },
      specifications,
      tokenUsage,
      system,
      instruction: buildAdvocateInstruction(),
    });

    const skeptic = await this.runPhase({
      state,
      port,
      phase: "skeptic",
      budgetTokens: budget.skeptic,
      context: { evaluateeUserId, periodId, manifest: input.evidence },
      specifications,
      tokenUsage,
      system,
      instruction: buildSkepticInstruction(advocate.text),
    });

    const synthesis = await this.runPhase({
      state,
      port,
      phase: "synthesis",
      budgetTokens: budget.synthesis,
      context: { evaluateeUserId, periodId, manifest: input.evidence },
      specifications,
      tokenUsage,
      system,
      instruction: buildSynthesisInstruction({
        criteria,
        advocateText: advocate.text,
        skepticText: skeptic.text,
      }),
    });

    let parsed: ReturnType<typeof parseJudgmentOutput>;
    try {
      parsed = parseJudgmentOutput(synthesis.text, criteria);
    } catch (error) {
      if (synthesis.stopReason) {
        throw new Error(
          `Judgment synthesis stopped early (${synthesis.stopReason}) and returned no parseable verdicts; failing the run rather than recording a partial judgment.`,
          { cause: error },
        );
      }
      throw error;
    }
    const verdicts: EvaluationVerdict[] = parsed.verdicts;

    // Skeptic challenges the synthesis could not answer stay on the record:
    // they are appended to the summary rather than dropped (the skeleton
    // result shape has no dedicated field for them).
    const summary =
      parsed.unresolved.length > 0
        ? `${parsed.summary}\n\nUnresolved challenges:\n${parsed.unresolved
            .map((item) => `- ${item.challenge} — ${item.response || "unanswered"}`)
            .join("\n")}`
        : parsed.summary;

    // Every early stop is recorded as skipped work — a phase that ran out of
    // budget, time or tool rounds must never look like it read everything.
    const stopSkipped = (
      [
        { phase: "advocate" as PhaseName, stopReason: advocate.stopReason },
        { phase: "skeptic" as PhaseName, stopReason: skeptic.stopReason },
        { phase: "synthesis" as PhaseName, stopReason: synthesis.stopReason },
      ] as { phase: PhaseName; stopReason?: PhaseStopReason }[]
    ).filter((stop) => stop.stopReason);

    const skippedItems = [
      ...parsed.skipped.map((item) => item.what),
      ...stopSkipped.map((stop) => `${stop.phase} drill-down`),
    ];
    const skippedReasons = [
      ...parsed.skipped.map((item) => item.reason),
      ...stopSkipped.map((stop) => `phase stopped early (${stop.stopReason})`),
    ];
    const skipped: EvaluationCoverageBucket | undefined =
      skippedItems.length > 0
        ? {
            total: skippedItems.length,
            note: skippedReasons.filter(Boolean).join("; ") || "not read",
            items: skippedItems,
          }
        : undefined;

    return {
      verdicts,
      findings: [],
      evaluatedRefs: Array.from(new Set(verdicts.flatMap((verdict) => verdict.evidenceRefs))),
      skipped,
      summary,
      metadata: {
        model: port.modelId,
        scope,
        promptVersion: WORK_EVALUATION_PROMPT_VERSION,
        tokenUsage,
      },
    };
  }

  // --- agent loop ----------------------------------------------------------

  private async runPhase(input: {
    state: WorkEvaluationJudgmentRunState;
    port: ChatModelPort;
    phase: PhaseName;
    budgetTokens: number;
    context: { evaluateeUserId: string; periodId: string; manifest: JudgmentInput["evidence"] };
    specifications: ToolSpecification[];
    tokenUsage: { total: number; byPhase: Record<string, number> };
    system: string;
    instruction: string;
  }): Promise<PhaseResult> {
    let spent = 0;
    let rounds = 0;
    const deadline = Date.now() + WORK_EVALUATION_PHASE_TIMEOUT_MS[input.phase];
    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.instruction },
    ];

    for (;;) {
      if (Date.now() >= deadline) {
        this.logger.warn(
          `Judgment phase ${input.phase} exceeded its ${WORK_EVALUATION_PHASE_TIMEOUT_MS[input.phase]}ms time limit.`,
        );
        return { text: "", stopReason: "time-limit" };
      }

      const result = await input.port.complete({
        messages,
        tools: input.specifications,
        temperature: 0.1,
      });
      spent += result.usage?.totalTokens ?? 0;
      input.tokenUsage.total += result.usage?.totalTokens ?? 0;
      input.tokenUsage.byPhase[input.phase] = spent;

      if (spent >= input.budgetTokens) {
        this.logger.warn(`Judgment phase ${input.phase} exhausted its token budget (${spent}/${input.budgetTokens}).`);
        return { text: result.text, stopReason: "token-budget" };
      }

      if (result.toolCalls.length === 0) {
        return { text: result.text };
      }

      // A provider that omits usage can never trip the token budget; the round
      // and wall-clock ceilings are what keep that case bounded.
      if (rounds >= WORK_EVALUATION_MAX_TOOL_ROUNDS) {
        this.logger.warn(
          `Judgment phase ${input.phase} reached its ${WORK_EVALUATION_MAX_TOOL_ROUNDS}-round tool limit.`,
        );
        return { text: result.text, stopReason: "tool-round-limit" };
      }
      rounds++;

      messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        messages.push(await this.executeTool(input.state, input.context, call));
      }
    }
  }

  private async executeTool(
    state: WorkEvaluationJudgmentRunState,
    context: { evaluateeUserId: string; periodId: string; manifest: JudgmentInput["evidence"] },
    call: ModelToolCall,
  ): Promise<ChatMessage> {
    try {
      const output = await this.tools.execute(state, context, call.name, call.arguments);
      return {
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        toolResult: JSON.stringify(output),
      };
    } catch (error) {
      return {
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        toolResult: error instanceof Error ? error.message : String(error),
        toolError: true,
      };
    }
  }

  // --- run inputs ------------------------------------------------------------

  private async homeCriteria(evaluateeUserId: string, periodId: string): Promise<string[]> {
    try {
      const homeGround = await this.periods.getHomeGround(evaluateeUserId, periodId);
      return Array.isArray(homeGround.homeCriteria) ? (homeGround.homeCriteria as string[]) : [];
    } catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
  }

  /**
   * Free-text tokens that could re-identify the member in drill-down output:
   * registered emails, linked-account display names and the profile name.
   * Resolved live from the account (ADR-026 D3) so renames never require
   * subject re-registration. Tokens shorter than four characters are dropped —
   * masking on "Al" would destroy more signal than it protects.
   */
  private async loadIdentityTokens(userId: string): Promise<Set<string>> {
    const [emails, identities, user] = await Promise.all([
      this.prisma.email.findMany({ where: { userId }, select: { email: true } }),
      this.prisma.accountExternalIdentity.findMany({ where: { userId }, select: { displayName: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, firstName: true, lastName: true } }),
    ]);
    const tokens = new Set<string>();
    const add = (value: string | null | undefined) => {
      const token = value?.trim();
      if (token && (token.includes("@") || token.length >= 4)) tokens.add(token);
    };
    for (const { email } of emails) add(email);
    for (const { displayName } of identities) add(displayName);
    add(user?.name);
    add(user?.firstName);
    add(user?.lastName);
    return tokens;
  }
}
