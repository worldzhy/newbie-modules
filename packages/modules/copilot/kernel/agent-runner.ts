import {
  AGENT_EVENT_PROTOCOL_VERSION,
  type AgentEvent,
  type AgentFailureCode,
  type AgentUsage,
  type CopilotSkillBlock,
} from "./agent-events";
import type { AgentRunInput, ChatHistoryMessage } from "./agent-execution-context";
import { ARGUMENT_SUMMARY_LIMIT, MAX_AGENT_STEPS, MODEL_TIMEOUT_MS } from "./agent-config";
import type { ChatMessage, ModelFinishReason, ModelStreamChunk, ModelUsage } from "./chat-model.port";
import { ModelCallError } from "./chat-model.port";
import type { CopilotAuditSink } from "./audit-sink";
import { NOOP_AUDIT_SINK } from "./audit-sink";
import { boundBlocks } from "./blocks";
import { redactValue, summarizeForLog } from "./redaction";
import { InMemoryConfirmationManager, type ConfirmationManager, type ConfirmationOutcome } from "./confirmation-manager";
import type { SkillEnvelope, SkillExecution } from "./skill-registry";
import { SkillRegistry } from "./skill-registry";
import type { SkillResultKind } from "./skill";
import { buildSystemPrompt, type PromptSectionProvider } from "./system-prompt";

const RESULT_SUMMARY_LIMIT = 140;

/**
 * Runs the agent tool loop against a ChatModelPort and a SkillRegistry and
 * yields the neutral event stream. The runner owns per-run working messages
 * (including tool calls/results); persisted conversation history contains
 * only user messages and final assistant answers.
 *
 * It has no knowledge of SSE, HTTP, or any model SDK.
 */
export class AgentRunner {
  constructor(
    private readonly registry: SkillRegistry,
    private readonly auditSink: CopilotAuditSink = NOOP_AUDIT_SINK,
    private readonly confirmations: ConfirmationManager = new InMemoryConfirmationManager(),
    private readonly promptSectionProviders: PromptSectionProvider[] = [],
  ) {}

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const { model, context } = input;
    const tools = this.registry.toolSpecificationsFor(context.transport);
    const offeredSkills = this.registry.listFor(context.transport, context.pageContext?.route).map((s) => s.name);

    yield {
      v: AGENT_EVENT_PROTOCOL_VERSION,
      type: "run-started",
      requestId: context.requestId,
      conversationId: context.conversationId,
      modelId: model.modelId,
      skills: offeredSkills,
    };

    const workingMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(context.pageContext, offeredSkills, this.promptSectionProviders) },
      ...input.history.map(toWorkingMessage),
      { role: "user", content: input.userMessage },
    ];

    const totalUsage: AgentUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let steps = 0;

    try {
      while (true) {
        if (context.signal.aborted) {
          yield failedEvent(context.requestId, "aborted", "The run was cancelled.", true);
          return;
        }

        steps += 1;
        let text = "";
        let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
        let finishReason: ModelFinishReason = "stop";
        let stepUsage: ModelUsage | undefined;
        const callStartedAt = Date.now();

        const stream: AsyncIterable<ModelStreamChunk> = model.stream({
          messages: workingMessages,
          tools,
          temperature: 0,
          timeoutMs: MODEL_TIMEOUT_MS,
          signal: context.signal,
        });

        try {
          for await (const chunk of stream) {
            if (chunk.type === "text-delta") {
              text += chunk.text;
              yield { v: AGENT_EVENT_PROTOCOL_VERSION, type: "text-delta", text: chunk.text };
            } else if (chunk.type === "tool-call") {
              toolCalls.push({
                id: chunk.toolCall.id,
                name: chunk.toolCall.name,
                arguments: chunk.toolCall.arguments,
              });
            } else if (chunk.type === "finish") {
              finishReason = chunk.finishReason;
              stepUsage = chunk.usage;
            }
          }
        } catch (error) {
          this.auditSink.record({
            category: "copilot.model_call",
            requestId: context.requestId,
            conversationId: context.conversationId,
            userId: context.userId,
            model: model.modelId,
            step: steps,
            latencyMs: Date.now() - callStartedAt,
            success: false,
            ...(error instanceof ModelCallError ? { errorCategory: error.category } : {}),
          });
          throw error;
        }

        this.auditSink.record({
          category: "copilot.model_call",
          requestId: context.requestId,
          conversationId: context.conversationId,
          userId: context.userId,
          model: model.modelId,
          step: steps,
          ...(stepUsage
            ? {
                promptTokens: stepUsage.promptTokens,
                completionTokens: stepUsage.completionTokens,
                totalTokens: stepUsage.totalTokens,
              }
            : {}),
          latencyMs: Date.now() - callStartedAt,
          success: true,
        });

        if (stepUsage) {
          totalUsage.promptTokens += stepUsage.promptTokens;
          totalUsage.completionTokens += stepUsage.completionTokens;
          totalUsage.totalTokens += stepUsage.totalTokens;
        }

        workingMessages.push({
          role: "assistant",
          ...(text ? { content: text } : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
        });

        if (toolCalls.length === 0) {
          yield {
            v: AGENT_EVENT_PROTOCOL_VERSION,
            type: "run-finished",
            requestId: context.requestId,
            steps,
            finishReason,
            usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
          };
          return;
        }

        if (steps >= MAX_AGENT_STEPS) {
          yield failedEvent(
            context.requestId,
            "step_limit",
            `The agent reached the ${MAX_AGENT_STEPS}-step tool-call limit without a final answer.`,
          );
          return;
        }

        for (const toolCall of toolCalls) {
          yield {
            v: AGENT_EVENT_PROTOCOL_VERSION,
            type: "tool-started",
            toolCallId: toolCall.id,
            name: toolCall.name,
            inputSummary: summarizeArguments(toolCall.arguments),
          };

          const startedAt = Date.now();
          const prepared = this.registry.prepare(context, toolCall.name, toolCall.arguments, startedAt);
          let execution: SkillExecution;
          let denied: ConfirmationOutcome | undefined;

          if (!prepared.ready) {
            execution = prepared.execution;
          } else if (this.registry.requiresConfirmation(toolCall.name)) {
            // Suspend the run: the transport renders an approval card and a
            // separate POST resolves this gate; the SSE stream stays open.
            const gate = this.confirmations.request(
              {
                userId: context.userId,
                conversationId: context.conversationId,
                requestId: context.requestId,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                arguments: redactValue(prepared.data),
              },
              context.signal,
            );
            this.auditSink.record({
              category: "copilot.confirmation",
              requestId: context.requestId,
              conversationId: context.conversationId,
              userId: context.userId,
              skillName: toolCall.name,
              toolCallId: toolCall.id,
              confirmationId: gate.confirmationId,
              phase: "required",
            });
            yield {
              v: AGENT_EVENT_PROTOCOL_VERSION,
              type: "confirm-required",
              confirmationId: gate.confirmationId,
              requestId: context.requestId,
              conversationId: context.conversationId,
              toolCallId: toolCall.id,
              name: toolCall.name,
              arguments: gate.pending.arguments,
            };

            const outcome = await gate.settled;
            denied = outcome.decision === "denied" ? outcome : undefined;
            yield {
              v: AGENT_EVENT_PROTOCOL_VERSION,
              type: "confirm-resolved",
              confirmationId: gate.confirmationId,
              toolCallId: toolCall.id,
              name: toolCall.name,
              decision: outcome.decision,
              reason: outcome.reason,
            };
            this.auditSink.record({
              category: "copilot.confirmation",
              requestId: context.requestId,
              conversationId: context.conversationId,
              userId: context.userId,
              skillName: toolCall.name,
              toolCallId: toolCall.id,
              confirmationId: gate.confirmationId,
              phase: "resolved",
              decision: outcome.decision,
              reason: outcome.reason,
            });

            execution = denied
              ? this.deniedExecution(toolCall.name, denied)
              : await this.registry.executePrepared(context, toolCall.name, prepared.data, prepared.startedAt);
          } else {
            execution = await this.registry.executePrepared(
              context,
              toolCall.name,
              prepared.data,
              prepared.startedAt,
            );
          }

          // FR-7: blocks are forwarded only for skills that opted in, and
          // only after bounding + redaction; they never re-enter the model
          // loop (the tool result below carries the envelope only).
          const blocks =
            !denied && this.registry.producesBlocks(toolCall.name) && execution.blocks?.length
              ? boundBlocks(redactValue(execution.blocks) as CopilotSkillBlock[])
              : undefined;

          yield {
            v: AGENT_EVENT_PROTOCOL_VERSION,
            type: "tool-finished",
            toolCallId: toolCall.id,
            name: toolCall.name,
            status: denied ? "denied" : execution.envelope.ok ? "success" : "error",
            summary: denied ? deniedSummary(denied) : summarizeEnvelope(execution.envelope, execution.kind),
            durationMs: execution.durationMs,
            ...(blocks?.length ? { blocks } : {}),
          };

          if (execution.envelope.ok && !denied) {
            for (const action of execution.actions) {
              yield {
                v: AGENT_EVENT_PROTOCOL_VERSION,
                type: "action",
                toolCallId: toolCall.id,
                source: toolCall.name,
                action,
              };
            }
          }

          workingMessages.push({
            role: "tool",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            toolResult: execution.envelope,
            toolError: !execution.envelope.ok,
          });
        }
      }
    } catch (error) {
      if (context.signal.aborted) {
        yield failedEvent(context.requestId, "aborted", "The run was cancelled.", true);
        return;
      }
      if (error instanceof ModelCallError) {
        yield failedEvent(context.requestId, modelErrorToCode(error.category), error.message);
        return;
      }
      yield failedEvent(
        context.requestId,
        "internal",
        error instanceof Error ? error.message : "Unexpected agent failure.",
      );
    }
  }

  /**
   * Builds the tool result fed back to the model when an approval gate is not
   * confirmed. The handler never ran; the model is told not to retry.
   */
  private deniedExecution(name: string, outcome: ConfirmationOutcome): SkillExecution {
    return {
      envelope: {
        ok: true,
        result: {
          content: deniedModelMessage(outcome),
          structured: { confirmation: "denied", reason: outcome.reason },
        },
      },
      durationMs: 0,
      actions: [],
      ...(this.registry.resultKind(name) ? { kind: this.registry.resultKind(name) } : {}),
    };
  }
}

function deniedModelMessage(outcome: ConfirmationOutcome): string {
  switch (outcome.reason) {
    case "user":
      return "The user declined to confirm this action. Do not retry it; acknowledge that it was cancelled.";
    case "timeout":
      return "No confirmation was received within the time limit, so the action was not executed. Tell the user they can ask again and confirm promptly.";
    case "aborted":
      return "The run was cancelled while waiting for confirmation, so the action was not executed.";
  }
}

function deniedSummary(outcome: ConfirmationOutcome): string {
  switch (outcome.reason) {
    case "user":
      return "Declined by the user; the action was not executed.";
    case "timeout":
      return "Confirmation timed out; the action was not executed.";
    case "aborted":
      return "Cancelled while waiting for confirmation; the action was not executed.";
  }
}

function toWorkingMessage(message: ChatHistoryMessage): ChatMessage {
  return { role: message.role, content: message.content };
}

function summarizeArguments(rawArguments: string): string {
  try {
    return summarizeForLog(JSON.parse(rawArguments), ARGUMENT_SUMMARY_LIMIT);
  } catch {
    const compact = rawArguments.replace(/\s+/g, " ").trim();
    return compact.length > ARGUMENT_SUMMARY_LIMIT ? `${compact.slice(0, ARGUMENT_SUMMARY_LIMIT)}…` : compact;
  }
}

function summarizeEnvelope(envelope: SkillEnvelope, declaredKind?: SkillResultKind): string {
  if (!envelope.ok) {
    return `error: ${envelope.error.code}`;
  }
  const kind = declaredKind ?? detectKind(envelope.result.structured);
  const count = detectCount(envelope.result.structured);
  const shape = count === undefined ? kind : `${kind} · ${count} item${count === 1 ? "" : "s"}`;
  const content = envelope.result.content?.trim();
  if (!content) return shape;
  const clipped = content.length > RESULT_SUMMARY_LIMIT ? `${content.slice(0, RESULT_SUMMARY_LIMIT)}…` : content;
  return `${shape} · ${clipped}`;
}

/** Fallback shape inference; real skills always provide a declared resultHint. */
function detectKind(value: unknown): SkillResultKind {
  if (Array.isArray(value)) return "list";
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return "list";
  }
  return "detail";
}

function detectCount(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const candidate = (value as Record<string, unknown>).items;
    if (Array.isArray(candidate)) return candidate.length;
  }
  return undefined;
}

function modelErrorToCode(category: ModelCallError["category"]): AgentFailureCode {
  switch (category) {
    case "timeout":
      return "model_timeout";
    case "aborted":
      return "aborted";
    case "auth":
      return "model_auth";
    case "rate-limit":
      return "model_rate_limited";
    case "bad-request":
      return "model_bad_request";
    default:
      return "model_upstream";
  }
}

function failedEvent(requestId: string, code: AgentFailureCode, message: string, aborted = false): AgentEvent {
  return {
    v: AGENT_EVENT_PROTOCOL_VERSION,
    type: "failed",
    requestId,
    code,
    message,
    ...(aborted ? { aborted: true } : {}),
  };
}
