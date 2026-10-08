/**
 * Neutral agent event protocol (protocol version 1).
 *
 * The kernel emits these transport-agnostic events; the SSE controller and
 * any future transport (chat bot, etc.) translate them. Nothing here mirrors
 * the AI SDK's native stream shapes (FR-10, FR-25).
 */

export const AGENT_EVENT_PROTOCOL_VERSION = 1 as const;

export interface SkillActionLink {
  type: "link";
  label: string;
  href: string;
}

export type SkillAction = SkillActionLink;

// ---------------------------------------------------------------------------
// Skill result blocks (FR-6): structured chart/table/query payloads a skill
// may return for transport rendering. Blocks are additive to the protocol;
// the tool-finished event carries them for opted-in skills (Task 3).
// ---------------------------------------------------------------------------

export interface CopilotChartDataset {
  label: string;
  data: number[];
}

export interface CopilotChartBlock {
  kind: "chart";
  chartType: "line" | "bar" | "pie" | "doughnut";
  title: string;
  labels: string[];
  datasets: CopilotChartDataset[];
  /** True when points were cut to the bounded cap before emission (NFR-2). */
  truncated?: boolean;
}

export interface CopilotTableColumn {
  field: string;
  header: string;
  width?: number;
  formatHint?: "ms" | "pct";
}

export interface CopilotTableBlock {
  kind: "table";
  title: string;
  columns: CopilotTableColumn[];
  rows: Array<Record<string, unknown>>;
  /** Row count before the bounded cap was applied (>= rows.length). */
  totalRows: number;
  /** True when rows were cut to the bounded cap before emission (NFR-2). */
  truncated?: boolean;
}

export interface CopilotQueryBlock {
  kind: "query";
  templateId: string;
  title: string;
  sql: string;
  /** True when the rendered SQL was truncated to stay within the byte budget. */
  truncated?: boolean;
}

/** Block-level degradation notice when a single query fails (FR-6). */
export interface CopilotErrorBlock {
  kind: "error";
  title: string;
  message: string;
  truncated?: boolean;
}

export type CopilotSkillBlock = CopilotChartBlock | CopilotTableBlock | CopilotQueryBlock | CopilotErrorBlock;

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type AgentFailureCode =
  | "no_active_model"
  | "step_limit"
  | "aborted"
  | "model_timeout"
  | "model_auth"
  | "model_rate_limited"
  | "model_bad_request"
  | "model_upstream"
  | "internal";

export type AgentEvent =
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "run-started";
      requestId: string;
      conversationId: string;
      modelId: string;
      skills: string[];
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "text-delta";
      text: string;
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "tool-started";
      toolCallId: string;
      name: string;
      /** Truncated, length-bounded preview of the validated arguments. */
      inputSummary: string;
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "tool-finished";
      toolCallId: string;
      name: string;
      /** "denied" means a confirmation gate blocked the handler; it never ran. */
      status: "success" | "error" | "denied";
      /** Type-level summary only; raw structured payload is never embedded. */
      summary: string;
      durationMs: number;
      /**
       * Optional structured blocks (FR-7, additive - protocol stays v1).
       * Present only for skills that declare producesBlocks; bounded and
       * redacted before emission.
       */
      blocks?: CopilotSkillBlock[];
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "confirm-required";
      /** Opaque id the transport echoes back to the confirm endpoint. */
      confirmationId: string;
      requestId: string;
      conversationId: string;
      toolCallId: string;
      name: string;
      /** Full validated arguments (redacted) for the approval card. */
      arguments: unknown;
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "confirm-resolved";
      confirmationId: string;
      toolCallId: string;
      name: string;
      decision: "confirmed" | "denied";
      /** Why the gate settled: user action, the wait timeout, or run abort. */
      reason: "user" | "timeout" | "aborted";
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "action";
      toolCallId: string;
      source: string;
      action: SkillAction;
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "run-finished";
      requestId: string;
      steps: number;
      finishReason: "stop" | "tool-calls" | "length" | "error" | "other";
      usage?: AgentUsage;
    }
  | {
      v: typeof AGENT_EVENT_PROTOCOL_VERSION;
      type: "failed";
      requestId: string;
      code: AgentFailureCode;
      message: string;
      /** True when the failure was caused by caller/transport cancellation. */
      aborted?: boolean;
    };
