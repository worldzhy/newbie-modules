import { Injectable, Logger } from "@nestjs/common";
import type { CopilotAuditEntry, CopilotAuditSink } from "../kernel/audit-sink";
import type { KernelLogger } from "../kernel/skill-registry";

/**
 * Bridges the framework-free kernel audit seam to Nest's Logger. Entries are
 * serialized one-per-line as JSON so existing log shipping can index them;
 * the kernel itself guarantees no apiKey field ever enters an entry.
 */
@Injectable()
export class CopilotAuditLogger implements CopilotAuditSink, KernelLogger {
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
