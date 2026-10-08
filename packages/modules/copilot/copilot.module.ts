import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@devbie/newbie/prisma/prisma.module";
import { CopilotModelController } from "./model/management/copilot-model.controller";
import { CopilotModelService } from "./model/management/copilot-model.service";
import { ActiveChatModelResolver } from "./model/active-chat-model.resolver";
import {
  CONFIRMATION_MANAGER,
  InMemoryConfirmationManager,
} from "./kernel/confirmation-manager";
import {
  CONVERSATION_STORE,
  InMemoryConversationStore,
} from "./kernel/conversation-store";
import { CopilotAuditLogger } from "./observability/copilot-audit.logger";

/**
 * Copilot capability module. Owns the protocol-neutral agent kernel
 * infrastructure (conversation store + confirmation manager), the ChatModelPort
 * adapter set (openai-compatible + anthropic via the shared SDK factory), the
 * model-management CRUD service/controller, and the audit logger.
 *
 * AgentRunner and SkillRegistry are NOT provided here. The host application
 * assembles the concrete skill list (COPILOT_SKILL_DEFINITIONS) and constructs
 * both in its own providers, injecting CopilotAuditLogger exported by this
 * module. Transports (web SSE, lark webhook) likewise stay with the host and
 * inject ActiveChatModelResolver / AgentRunner / etc. from this module's
 * exports.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CopilotModelController],
  providers: [
    CopilotModelService,
    ActiveChatModelResolver,
    CopilotAuditLogger,
    { provide: CONVERSATION_STORE, useClass: InMemoryConversationStore },
    { provide: CONFIRMATION_MANAGER, useFactory: () => new InMemoryConfirmationManager() },
  ],
  exports: [
    CopilotModelService,
    ActiveChatModelResolver,
    CopilotAuditLogger,
    CONVERSATION_STORE,
    CONFIRMATION_MANAGER,
  ],
})
export class CopilotModule {}
