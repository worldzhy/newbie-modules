/**
 * Structured audit seam (FR-28, FR-29). The kernel depends on this interface
 * only; the Nest layer supplies a logger-backed implementation. No API key
 * field is ever part of these entries.
 */

export interface ModelCallAuditEntry {
  category: "copilot.model_call";
  requestId: string;
  conversationId: string;
  userId: string;
  model: string;
  /** 1-based tool-loop turn. */
  step: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  success: boolean;
  errorCategory?: string;
}

export type SkillAuditStatus =
  "success" | "invalid_arguments" | "unknown_skill" | "skill_failed" | "skill_timeout" | "aborted";

export interface SkillCallAuditEntry {
  category: "copilot.skill_call";
  requestId: string;
  conversationId: string;
  userId: string;
  skillName: string;
  /** Redacted, length-bounded JSON preview; never contains secrets. */
  argumentSummary: string;
  status: SkillAuditStatus;
  durationMs: number;
  /**
   * Summary of emitted blocks (FR-7): template id, block count, per-block
   * shape/row-point counts. Block payloads are never recorded.
   */
  blocksSummary?: string;
}

export interface ConfirmationAuditEntry {
  category: "copilot.confirmation";
  requestId: string;
  conversationId: string;
  userId: string;
  skillName: string;
  toolCallId: string;
  confirmationId: string;
  phase: "required" | "resolved";
  /** Present on phase=resolved only. */
  decision?: "confirmed" | "denied";
  reason?: "user" | "timeout" | "aborted";
}

export type CopilotAuditEntry = ModelCallAuditEntry | SkillCallAuditEntry | ConfirmationAuditEntry;

export interface CopilotAuditSink {
  record(entry: CopilotAuditEntry): void;
}

/** Default sink used when no observability adapter is wired: audit stays opt-in. */
export const NOOP_AUDIT_SINK: CopilotAuditSink = {
  record: () => undefined,
};
