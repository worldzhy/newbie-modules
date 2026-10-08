/**
 * Shared Vercel AI SDK v6 plumbing for every ChatModelPort adapter.
 *
 * This is the ONLY file under model/adapters allowed to import the `ai`
 * core package; concrete adapters import their own provider package
 * (e.g. @ai-sdk/openai-compatible, @ai-sdk/anthropic) and hand the
 * constructed LanguageModel to createSdkChatModel. If the SDK is replaced,
 * this file plus the adapter factories are all that needs to change.
 */
import { APICallError, type LanguageModel, type ModelMessage, generateText, jsonSchema, streamText } from "ai";
import {
  ChatMessage,
  ChatModelPort,
  ChatRequest,
  ChatResult,
  ModelCallError,
  ModelErrorCategory,
  ModelFinishReason,
  ModelStreamChunk,
  ModelToolCall,
  ModelUsage,
  ToolSpecification,
} from "../../kernel/chat-model.port";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Wraps an AI SDK LanguageModel (already bound to a concrete provider,
 * endpoint and credentials) in the provider-neutral ChatModelPort.
 */
export function createSdkChatModel(modelId: string, languageModel: LanguageModel): ChatModelPort {
  return {
    modelId,

    async complete(request: ChatRequest): Promise<ChatResult> {
      const { system, messages } = splitSystem(request.messages);
      const deadline = withTimeout(request.signal, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const result = await generateText({
          model: languageModel,
          ...(system ? { system } : {}),
          messages,
          ...(request.tools?.length ? { tools: toSdkTools(request.tools) } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          abortSignal: deadline.signal,
        });

        return {
          text: result.text ?? "",
          toolCalls: (result.toolCalls ?? []).map(toModelToolCall),
          usage: normalizeUsage(result.usage),
          finishReason: mapFinishReason(String(result.finishReason)),
        };
      } catch (error) {
        throw classifyError(error, deadline);
      } finally {
        deadline.cleanup();
      }
    },

    async *stream(request: ChatRequest): AsyncIterable<ModelStreamChunk> {
      const { system, messages } = splitSystem(request.messages);
      const deadline = withTimeout(request.signal, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      try {
        const result = streamText({
          model: languageModel,
          ...(system ? { system } : {}),
          messages,
          ...(request.tools?.length ? { tools: toSdkTools(request.tools) } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
          abortSignal: deadline.signal,
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              if (part.text) {
                yield { type: "text-delta", text: part.text };
              }
              break;
            case "tool-call":
              yield {
                type: "tool-call",
                toolCall: {
                  id: part.toolCallId,
                  name: part.toolName,
                  arguments: JSON.stringify(part.input ?? {}),
                },
              };
              break;
            case "finish":
              yield {
                type: "finish",
                finishReason: mapFinishReason(String(part.finishReason)),
                usage: normalizeUsage(part.totalUsage),
              };
              break;
            case "error":
              throw classifyError(part.error, deadline);
            case "abort":
              throw classifyError(new Error("aborted"), deadline);
            default:
              // start / source / tool-input-* parts are transport-internal.
              break;
          }
        }
      } catch (error) {
        if (error instanceof ModelCallError) throw error;
        throw classifyError(error, deadline);
      } finally {
        deadline.cleanup();
      }
    },
  };
}

function splitSystem(messages: ChatMessage[]): { system?: string; messages: ModelMessage[] } {
  const systemParts: string[] = [];
  const rest: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) systemParts.push(message.content);
    } else {
      rest.push(message);
    }
  }
  return {
    ...(systemParts.length ? { system: systemParts.join("\n\n") } : {}),
    messages: rest.map(toSdkMessage),
  };
}

function toSdkMessage(message: ChatMessage): ModelMessage {
  if (message.role === "tool") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.toolCallId ?? "",
          toolName: message.toolName ?? "",
          output: {
            type: "json",
            // Failures are encoded as a structured error object so the model
            // can self-correct; the protocol has no isError flag in this SDK.
            value: (message.toolResult ?? {}) as never,
          },
        },
      ],
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...message.toolCalls.map((toolCall) => ({
          type: "tool-call" as const,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: safeParseArguments(toolCall.arguments),
        })),
      ],
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

function toSdkTools(
  tools: ToolSpecification[],
): Record<string, { description?: string; inputSchema: ReturnType<typeof jsonSchema> }> {
  const mapped: Record<string, { description?: string; inputSchema: ReturnType<typeof jsonSchema> }> = {};
  for (const tool of tools) {
    mapped[tool.function.name] = {
      ...(tool.function.description ? { description: tool.function.description } : {}),
      inputSchema: jsonSchema(tool.function.parameters ?? { type: "object", properties: {} }),
    };
  }
  return mapped;
}

function toModelToolCall(raw: { toolCallId?: string; toolName?: string; input?: unknown }): ModelToolCall {
  return {
    id: raw.toolCallId ?? "",
    name: raw.toolName ?? "",
    arguments: JSON.stringify(raw.input ?? {}),
  };
}

function safeParseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeUsage(usage: unknown): ModelUsage | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const candidate = usage as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    // Legacy field names kept defensively for older SDK builds.
    promptTokens?: number;
    completionTokens?: number;
  };
  const promptTokens = candidate.inputTokens ?? candidate.promptTokens ?? 0;
  const completionTokens = candidate.outputTokens ?? candidate.completionTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: candidate.totalTokens ?? promptTokens + completionTokens,
  };
}

function mapFinishReason(raw: string): ModelFinishReason {
  switch (raw) {
    case "stop":
    case "tool-calls":
    case "length":
    case "error":
      return raw;
    default:
      return "other";
  }
}

function withTimeout(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void; timedOut: boolean } {
  const controller = new AbortController();
  // Mutable holder: the shorthand object property would otherwise capture
  // `false` by value and never observe the timer firing.
  const state = { timedOut: false };
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort("timeout");
  }, timeoutMs);

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason), {
        once: true,
      });
    }
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return state.timedOut;
    },
    cleanup: () => clearTimeout(timer),
  };
}

function classifyError(error: unknown, deadline: { timedOut: boolean; signal: AbortSignal }): ModelCallError {
  if (deadline.timedOut) {
    return new ModelCallError("timeout", "The model request timed out.");
  }
  if (deadline.signal.aborted || abortSucceeded(error)) {
    return new ModelCallError("aborted", "The model request was aborted.");
  }
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode;
    const message = error.message || "The upstream model API returned an error.";
    return new ModelCallError(statusToCategory(statusCode), message, statusCode);
  }
  if (error instanceof Error) {
    return new ModelCallError("upstream", error.message);
  }
  return new ModelCallError("upstream", "Unknown model call failure.");
}

function abortSucceeded(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message?.includes("aborted"));
}

function statusToCategory(statusCode: number | undefined): ModelErrorCategory {
  if (statusCode === 401 || statusCode === 403) return "auth";
  if (statusCode === 429) return "rate-limit";
  if (statusCode === 400 || statusCode === 422) return "bad-request";
  return "upstream";
}
