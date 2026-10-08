import { Injectable } from "@nestjs/common";
import { CopilotModelService } from "../management/copilot-model.service";
import { ANTHROPIC_PROVIDER } from "../management/copilot-providers";
import { createAnthropicChatModel } from "./adapters/anthropic-chat-model.adapter";
import { createOpenAiCompatibleChatModel } from "./adapters/openai-compatible-chat-model.adapter";
import { ChatModelPort, NoActiveModelError } from "../kernel/chat-model.port";

/**
 * Builds a ChatModelPort for the currently active Copilot model. The active
 * record is read on every resolution so admin-side switching takes effect on
 * the next run without a restart. The record's provider protocol decides
 * which adapter factory handles the record.
 */
@Injectable()
export class ActiveChatModelResolver {
  constructor(private readonly copilotModels: CopilotModelService) {}

  async resolve(): Promise<ChatModelPort> {
    const record = await this.copilotModels.getActive();
    if (!record) {
      throw new NoActiveModelError();
    }
    if (record.provider === ANTHROPIC_PROVIDER) {
      return createAnthropicChatModel({
        model: record.model,
        apiKey: record.apiKey,
        // Empty string means "use the official api.anthropic.com endpoint".
        baseUrl: record.baseUrl || undefined,
      });
    }
    return createOpenAiCompatibleChatModel({
      model: record.model,
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
    });
  }
}
