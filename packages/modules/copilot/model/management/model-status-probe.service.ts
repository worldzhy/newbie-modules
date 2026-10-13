import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ActiveChatModelResolver } from "../active-chat-model.resolver";
import { CopilotModelService } from "./copilot-model.service";
import { type ChatModelPort, ModelCallError, NoActiveModelError } from "../../kernel/chat-model.port";

/**
 * Periodically probes the active Copilot model so its status snapshot reflects
 * real-world availability (e.g. an expired quota or a rotated key) even when
 * no user chat has been initiated. The probe goes through the same
 * ChatModelPort path as a real call, so error classification (including the
 * "payment" category) is identical to what AgentRunner would record.
 *
 * The outcome is folded into the record via ModelHealthSink, exactly like a
 * user-initiated call. Aborted probes (e.g. shutdown) are not recorded.
 */
@Injectable()
export class ModelStatusProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelStatusProbeService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly intervalMs = 5 * 60 * 1000;
  private readonly probeTimeoutMs = 15_000;

  constructor(
    private readonly resolver: ActiveChatModelResolver,
    private readonly healthSink: CopilotModelService,
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
   * Probes the active model once. Public so E2E tests and manual triggers can
   * bypass the interval. A no-op when no active model is configured.
   */
  async probeNow(): Promise<void> {
    let model: ChatModelPort;
    try {
      model = await this.resolver.resolve();
    } catch (error) {
      if (error instanceof NoActiveModelError) return;
      throw error;
    }
    if (!model.modelRecordId) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);

    try {
      await model.complete({
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1,
        signal: controller.signal,
        timeoutMs: this.probeTimeoutMs,
      });
      this.healthSink.recordModelCallOutcome({
        modelRecordId: model.modelRecordId,
        success: true,
      });
    } catch (error) {
      if (error instanceof ModelCallError && error.category !== "aborted") {
        this.healthSink.recordModelCallOutcome({
          modelRecordId: model.modelRecordId,
          success: false,
          errorCategory: error.category,
          errorMessage: error.message,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
