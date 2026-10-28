import { Global, Module } from "@nestjs/common";
import { LlmConnectionController } from "./management/llm-connection.controller";
import { LlmConnectionService } from "./management/llm-connection.service";
import { LlmScopeCatalog } from "./management/llm-scope-catalog.service";
import { LlmScopeController } from "./management/llm-scope.controller";
import { LlmScopeService } from "./management/llm-scope.service";
import { ModelStatusProbeService } from "./management/model-status-probe.service";
import { ChatModelResolver } from "./chat-model.resolver";

/**
 * Unified LLM provider module (ADR-006): the single AI model provider for the
 * whole system. Owns the provider-neutral ChatModelPort, the adapter set
 * (openai-compatible + anthropic via the shared SDK bridge), the connection
 * registry (LlmConnection), the scope catalog declared by consumers and the
 * scope-to-connection bindings (LlmScopeAssignment, ADR-043), the
 * ChatModelResolver with its provider-level health decorator, and the periodic
 * status probe.
 *
 * Consumers (copilot kernel, host analysis/jdy services,
 * ...) inject ChatModelResolver and resolve their own hardcoded scope, and
 * register that scope in the catalog at startup; none of them constructs an SDK
 * client directly. A connection can serve multiple scopes; health is shared
 * across all scopes using that connection.
 */
@Global()
@Module({
  controllers: [LlmConnectionController, LlmScopeController],
  providers: [LlmConnectionService, LlmScopeCatalog, LlmScopeService, ChatModelResolver, ModelStatusProbeService],
  exports: [LlmConnectionService, LlmScopeCatalog, LlmScopeService, ChatModelResolver],
})
export class LlmModule {}
