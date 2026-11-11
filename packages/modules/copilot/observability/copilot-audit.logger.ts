import { Injectable, Logger } from "@nestjs/common";
import type { CopilotAuditEntry, CopilotAuditSink } from "../kernel/audit-sink";
import type { KernelLogger } from "../kernel/skill-registry";
import { AuditActorType, AuditLogService, AuditResult } from "@modules/audit/audit-log.service";

/**
 * Bridges the framework-free kernel audit seam to both Nest's Logger (stdout
 * JSON) and the platform AuditLog table (via AuditLogService, fire-and-forget).
 *
 * Entries carry `transport`, `requestId`, `conversationId`, `userId` plus
 * skill/model-specific fields. The adapter maps each kernel category to an
 * `event` string in the open `copilot.*` domain. The AuditLog's detail JSON
 * mirrors the entry shape so the audit-logs page can filter by `event` and
 * inspect structured payloads — conversationId / requestId / transport /
 * model / skillName are all queryable keys.
 *
 * Redaction already happens in the kernel (argumentSummary, blocked payloads
 * only, no apiKey ever reaches an entry) so this layer never strips secrets.
 */
@Injectable()
export class CopilotAuditLogger implements CopilotAuditSink, KernelLogger {
  private readonly logger = new Logger("CopilotAudit");

  constructor(private readonly auditLogService: AuditLogService) {}

  record(entry: CopilotAuditEntry): void {
    // 1. Always write the Nest Logger JSON (existing contract, unaffected by
    // whether the platform audit table is wired).
    this.logger.log(JSON.stringify(entry));

    // 2. Also record to the platform AuditLog table when available.
    if (!this.auditLogService) return;

    try {
      const event = this.eventFor(entry);
      const detail = this.detailFrom(entry);
      const actorId = entry.userId.startsWith("lark:") ? undefined : entry.userId;
      const actorType = entry.userId.startsWith("lark:") ? AuditActorType.SYSTEM : AuditActorType.USER;

      const result =
        entry.category === "copilot.model_call"
          ? entry.success
            ? AuditResult.SUCCESS
            : AuditResult.FAILURE
          : entry.category === "copilot.skill_call"
            ? entry.status === "success"
              ? AuditResult.SUCCESS
              : AuditResult.FAILURE
            : undefined; // confirmation has no success/failure outcome

      // Promise intentionally not awaited: an audit failure must never break
      // the primary flow. AuditLogService itself also swallows errors.
      void this.auditLogService.record(event, {
        actorType,
        actorId,
        result,
        resourceType: entry.category === "copilot.skill_call" ? "CopilotSkill" : undefined,
        resourceId:
          entry.category === "copilot.confirmation"
            ? entry.confirmationId
            : entry.category === "copilot.skill_call"
              ? entry.skillName
              : undefined,
        detail,
      });
    } catch (error) {
      this.logger.error(`Copilot → AuditLog bridge failed: ${String(error)}`);
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta ? JSON.stringify(meta) : undefined);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta ? JSON.stringify(meta) : undefined);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.log(message, meta ? JSON.stringify(meta) : undefined);
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private eventFor(entry: CopilotAuditEntry): string {
    switch (entry.category) {
      case "copilot.model_call":
        return "copilot.model_call";
      case "copilot.skill_call":
        return "copilot.skill_call";
      case "copilot.confirmation":
        return entry.phase === "required" ? "copilot.confirmation.required" : "copilot.confirmation.resolved";
    }
  }

  private detailFrom(entry: CopilotAuditEntry): Record<string, unknown> {
    const base = {
      conversationId: entry.conversationId,
      requestId: entry.requestId,
      userId: entry.userId,
      transport: entry.transport,
    };
    switch (entry.category) {
      case "copilot.model_call":
        return {
          ...base,
          model: entry.model,
          step: entry.step,
          ...(entry.promptTokens !== undefined ? { promptTokens: entry.promptTokens } : {}),
          ...(entry.completionTokens !== undefined ? { completionTokens: entry.completionTokens } : {}),
          ...(entry.totalTokens !== undefined ? { totalTokens: entry.totalTokens } : {}),
          latencyMs: entry.latencyMs,
          success: entry.success,
          ...(entry.errorCategory ? { errorCategory: entry.errorCategory } : {}),
        };
      case "copilot.skill_call":
        return {
          ...base,
          skillName: entry.skillName,
          argumentSummary: entry.argumentSummary,
          status: entry.status,
          durationMs: entry.durationMs,
          ...(entry.blocksSummary ? { blocksSummary: entry.blocksSummary } : {}),
        };
      case "copilot.confirmation":
        return {
          ...base,
          skillName: entry.skillName,
          toolCallId: entry.toolCallId,
          confirmationId: entry.confirmationId,
          phase: entry.phase,
          ...(entry.decision ? { decision: entry.decision } : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
        };
    }
  }
}
