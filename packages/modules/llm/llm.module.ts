import { Global, Module } from "@nestjs/common";
import { LlmModelController } from "./management/llm-model.controller";
import { LlmModelService } from "./management/llm-model.service";
import { ModelStatusProbeService } from "./management/model-status-probe.service";
import { ChatModelResolver } from "./chat-model.resolver";

/**
 * Unified LLM provider module (ADR-005): the single AI model provider for the
 * whole system. Owns the provider-neutral ChatModelPort, the adapter set
 * (openai-compatible + anthropic via the shared SDK bridge), the scoped model
 * registry (one active record per consumer scope), the ChatModelResolver with
 * its provider-level health decorator, and the periodic status probe.
 *
 * Consumers (copilot kernel, backend-monitor ai-analysis, host jdy services,
 * ...) inject ChatModelResolver and resolve their own hardcoded scope; none of
 * them constructs an SDK client directly.
 */
@Global()
@Module({
  controllers: [LlmModelController],
  providers: [LlmModelService, ChatModelResolver, ModelStatusProbeService],
  exports: [LlmModelService, ChatModelResolver],
})
export class LlmModule {}
