import { Injectable } from "@nestjs/common";
import { LlmModelService, ModelCallOutcome } from "./management/llm-model.service";
import { ANTHROPIC_PROVIDER } from "./management/llm-providers";
import { createAnthropicChatModel } from "./adapters/anthropic.adapter";
import { createOpenAiCompatibleChatModel } from "./adapters/openai-compatible.adapter";
import {
  ChatModelPort,
  ChatRequest,
  ChatResult,
  ModelCallError,
  ModelStreamChunk,
  NoActiveModelError,
} from "./chat-model.port";

/**
 * Builds a ChatModelPort for the active model of a consumer scope. The active
 * record is read on every resolution so admin-side switching takes effect on
 * the next call without a restart. The record's provider protocol decides
 * which adapter factory handles the record.
 *
 * Every returned port is wrapped in the provider-level health decorator
 * (ADR-005): each call's terminal outcome (success, or a classified failure;
 * user aborts excluded) is folded into the record's health snapshot. This is
 * the single emission point, so health coverage is uniform across consumers.
 */
@Injectable()
export class ChatModelResolver {
  constructor(private readonly llmModels: LlmModelService) {}

  async resolve(scope: string): Promise<ChatModelPort> {
    const record = await this.llmModels.getActive(scope);
    if (!record) {
      throw new NoActiveModelError(scope);
    }
    const port =
      record.provider === ANTHROPIC_PROVIDER
        ? createAnthropicChatModel({
            model: record.model,
            apiKey: record.apiKey,
            // Empty string means "use the official api.anthropic.com endpoint".
            baseUrl: record.baseUrl || undefined,
          })
        : createOpenAiCompatibleChatModel({
            model: record.model,
            baseUrl: record.baseUrl,
            apiKey: record.apiKey,
          });
    return withHealthTracking(port, record.id, (outcome) => this.llmModels.recordModelCallOutcome(outcome));
  }
}

/**
 * Decorates a port so every complete/stream terminal outcome is reported
 * fire-and-forget. A stream counts as successful only when fully consumed;
 * aborts surface as an "aborted" ModelCallError and are never recorded.
 */
function withHealthTracking(
  port: ChatModelPort,
  modelRecordId: string,
  record: (outcome: ModelCallOutcome) => void,
): ChatModelPort {
  const recordFailure = (error: unknown): void => {
    if (error instanceof ModelCallError && error.category !== "aborted") {
      record({
        modelRecordId,
        success: false,
        errorCategory: error.category,
        errorMessage: error.message,
      });
    }
  };

  return {
    modelId: port.modelId,

    async complete(request: ChatRequest): Promise<ChatResult> {
      try {
        const result = await port.complete(request);
        record({ modelRecordId, success: true });
        return result;
      } catch (error) {
        recordFailure(error);
        throw error;
      }
    },

    async *stream(request: ChatRequest): AsyncIterable<ModelStreamChunk> {
      try {
        for await (const chunk of port.stream(request)) {
          yield chunk;
        }
        record({ modelRecordId, success: true });
      } catch (error) {
        recordFailure(error);
        throw error;
      }
    },
  };
}
