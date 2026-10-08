import type { ChatModelPort } from "./chat-model.port";

/**
 * Server-injected execution context handed to every skill invocation.
 *
 * Identity is never accepted from model-produced tool arguments: the runner
 * constructs this object per request from authenticated transport state and
 * passes it explicitly to skill handlers (FR-11, AC-4).
 */
export type CopilotTransport = "web" | "lark";

export interface AgentPageContext {
  /** Current dashboard route identifier, e.g. `/projects/[id]`. */
  route?: string;
  /** Sanitized route parameters known to the server. */
  params?: Record<string, string>;
}

export interface AgentExecutionContext {
  readonly userId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly transport: CopilotTransport;
  /** Aborts both the model call and in-flight skill work on client disconnect. */
  readonly signal: AbortSignal;
  readonly pageContext?: AgentPageContext;
}

export interface AgentRunInput {
  readonly model: ChatModelPort;
  readonly context: AgentExecutionContext;
  /** Latest user message; the client never submits history. */
  readonly userMessage: string;
  /** Prior turns assembled by the conversation store (user/final-answer only). */
  readonly history: ChatHistoryMessage[];
}

/** Persisted history is conversational only; tool-loop messages are per-run. */
export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}
