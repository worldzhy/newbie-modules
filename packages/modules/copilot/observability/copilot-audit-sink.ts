import { Injectable, Logger } from "@nestjs/common";
import type { CopilotAuditEntry, CopilotAuditSink } from "@modules/copilot/kernel/audit-sink";
import type { KernelLogger } from "@modules/copilot/kernel/skill-registry";

/**
 * Registry-side audit sink. Bridges the framework-free kernel audit seam
 * to Nest's Logger only (stdout JSON, one entry per line). Entries are
 * serialized as raw CopilotAuditEntry objects; the kernel guarantees no
 * apiKey ever enters an entry (see kernel/redaction.ts).
 *
 * Hosts that also need to write the platform AuditLog table extend this
 * class or provide their own CopilotAuditSink implementation — the
 * SkillRegistry constructor accepts any CopilotAuditSink, so host
 * observability layers are fully pluggable.
 */
@Injectable()
export class NestLoggerCopilotAuditSink implements CopilotAuditSink, KernelLogger {
  private readonly logger = new Logger("CopilotAudit");

  record(entry: CopilotAuditEntry): void {
    this.logger.log(JSON.stringify(entry));
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
}
