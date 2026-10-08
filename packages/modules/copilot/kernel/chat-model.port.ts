/**
 * Provider-neutral chat model port for the Copilot agent kernel.
 *
 * Everything in the kernel (runner, skills, sessions) depends on this
 * interface, never on a concrete SDK. The AI SDK implementation lives in a
 * single adapter file and can be replaced without touching kernel logic.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ModelToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments as emitted by the model. The runner parses and validates. */
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  /** Text content for system/user/assistant messages. */
  content?: string;
  /** Tool calls requested by an assistant turn. */
  toolCalls?: ModelToolCall[];
  /** Correlation id for a `tool` role message. */
  toolCallId?: string;
  /** Tool name for a `tool` role message (required by some providers). */
  toolName?: string;
  /** Structured tool payload already serialized to string for `tool` messages. */
  toolResult?: unknown;
  /** Set when a tool execution failed; the model may self-correct. */
  toolError?: boolean;
}

export interface ToolSpecification {
  type: "function";
  function: {
    name: string;
    description?: string;
    /** Standard JSON Schema object describing the arguments. */
    parameters?: Record<string, unknown>;
  };
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type ModelFinishReason = "stop" | "tool-calls" | "length" | "error" | "other";

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpecification[];
  temperature?: number;
  maxTokens?: number;
  /** Default timeout is applied by the adapter when omitted. */
  timeoutMs?: number;
  /** Cancellation propagates to the upstream HTTP request. */
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls: ModelToolCall[];
  usage?: ModelUsage;
  finishReason: ModelFinishReason;
}

export type ModelStreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: ModelToolCall }
  | { type: "finish"; finishReason: ModelFinishReason; usage?: ModelUsage };

export interface ChatModelPort {
  /** Human-readable provider/model identifier for audit logs. */
  readonly modelId: string;
  complete(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<ModelStreamChunk>;
}

export type ModelErrorCategory = "timeout" | "aborted" | "auth" | "rate-limit" | "bad-request" | "upstream";

/** Normalized failure so transports never inspect SDK-specific error shapes. */
export class ModelCallError extends Error {
  constructor(
    readonly category: ModelErrorCategory,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

/** Raised when the admin has not configured an active Copilot model. */
export class NoActiveModelError extends Error {
  constructor() {
    super("No active Copilot model is configured.");
    this.name = "NoActiveModelError";
  }
}
