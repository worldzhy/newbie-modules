import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ChatModelResolver } from "../chat-model.resolver";
import { LlmConnectionService, type LlmConnectionRecord } from "./llm-connection.service";
import { ModelCallError } from "../chat-model.port";

/**
 * Periodically probes every LLM connection so each status snapshot reflects
 * real-world availability (e.g. an expired quota or a rotated key) even when
 * no consumer call has been made. The probe goes through the same
 * ChatModelResolver path as a real call (resolveById, shared adapter), so
 * error classification is identical to what consumers record.
 *
 * Outcomes are folded into the connection by the resolver's health decorator,
 * exactly like a consumer-initiated call; the probe never reports manually.
 * A single connection serves multiple scopes, so probing once covers all of them.
 */
@Injectable()
export class ModelStatusProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelStatusProbeService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly intervalMs = 5 * 60 * 1000;
  private readonly probeTimeoutMs = 15_000;

  constructor(
    private readonly resolver: ChatModelResolver,
    private readonly connections: LlmConnectionService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.probeNow().catch((err: unknown) => {
        this.logger.warn(`Model status probe failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Probes every LlmConnection once. Public so E2E tests and manual triggers
   * can bypass the interval. A no-op when no connections exist.
   */
  async probeNow(): Promise<void> {
    const all = await this.connections.listAll();
    await Promise.all(
      all.map(async (connection: LlmConnectionRecord) => {
        try {
          const model = await this.resolver.resolveById(connection.id);
          await model.complete({
            messages: [{ role: "user", content: "Hi" }],
            maxTokens: 1,
            timeoutMs: this.probeTimeoutMs,
          });
        } catch (error) {
          // The resolver's health decorator already recorded the outcome.
          // ModelCallError is an expected probe result (that is the point of probing).
          if (!(error instanceof ModelCallError)) {
            this.logger.warn(
              `Model status probe for connection ${connection.id} (${connection.provider}/${connection.model}) ` +
                `hit an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }),
    );
  }
}
