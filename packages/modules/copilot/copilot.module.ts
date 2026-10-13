import { Global, Module } from "@nestjs/common";
import { CONFIRMATION_MANAGER, InMemoryConfirmationManager } from "./kernel/confirmation-manager";
import { CONVERSATION_STORE, InMemoryConversationStore } from "./kernel/conversation-store";
import { CopilotAuditLogger } from "./observability/copilot-audit.logger";

/**
 * Copilot capability module. Owns the protocol-neutral agent kernel
 * infrastructure (conversation store + confirmation manager) and the audit
 * logger. The LLM model provider lives in the `llm` module (ADR-005); the
 * kernel depends on its ChatModelPort and the host transports resolve the
 * "copilot" scope via ChatModelResolver exported there.
 *
 * AgentRunner and SkillRegistry are NOT provided here. The host application
 * assembles the concrete skill list (COPILOT_SKILL_DEFINITIONS) and constructs
 * both in its own providers, injecting CopilotAuditLogger exported by this
 * module. Transports (web SSE, lark webhook) likewise stay with the host and
 * inject ChatModelResolver / AgentRunner / etc. from the two modules' exports.
 */
@Global()
@Module({
  providers: [
    CopilotAuditLogger,
    { provide: CONVERSATION_STORE, useClass: InMemoryConversationStore },
    { provide: CONFIRMATION_MANAGER, useFactory: () => new InMemoryConfirmationManager() },
  ],
  exports: [CopilotAuditLogger, CONVERSATION_STORE, CONFIRMATION_MANAGER],
})
export class CopilotModule {}
