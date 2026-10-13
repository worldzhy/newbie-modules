import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ChatModelResolver } from "../chat-model.resolver";
import { LlmModelService } from "./llm-model.service";
import { ModelCallError, NoActiveModelError } from "../chat-model.port";

/**
 * Periodically probes the active model of every scope so each status snapshot
 * reflects real-world availability (e.g. an expired quota or a rotated key)
 * even when no consumer call has been made. The probe goes through the same
 * ChatModelResolver path as a real call, so error classification (including
 * the "payment" category) is identical to what consumers record.
 *
 * Outcomes are folded into the record by the resolver's health decorator,
 * exactly like a consumer-initiated call; the probe never reports manually.
 */
@Injectable()
export class ModelStatusProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelStatusProbeService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly intervalMs = 5 * 60 * 1000;
  private readonly probeTimeoutMs = 15_000;

  constructor(
    private readonly resolver: ChatModelResolver,
    private readonly llmModels: LlmModelService,
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
   * Probes every scope's active model once. Public so E2E tests and manual
   * triggers can bypass the interval. A no-op when nothing is active.
   */
  async probeNow(): Promise<void> {
    const activeRecords = await this.llmModels.listActive();
    await Promise.all(
      activeRecords.map(async (record) => {
        try {
          const model = await this.resolver.resolve(record.scope);
          await model.complete({
            messages: [{ role: "user", content: "Hi" }],
            maxTokens: 1,
            timeoutMs: this.probeTimeoutMs,
          });
        } catch (error) {
          // The resolver's health decorator already recorded the outcome.
          // NoActiveModelError races with admin-side changes; ModelCallError is
          // an expected probe result (that is the point of probing).
          if (!(error instanceof NoActiveModelError) && !(error instanceof ModelCallError)) {
            this.logger.warn(
              `Model status probe for scope "${record.scope}" hit an unexpected error: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }),
    );
  }
}
