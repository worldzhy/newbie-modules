import { Injectable, NotFoundException } from "@nestjs/common";
import { LlmConnectionService, ModelCallOutcome, type LlmConnectionRecord } from "./management/llm-connection.service";
import { ANTHROPIC_PROVIDER } from "./management/llm-providers";
import { createAnthropicChatModel } from "./adapters/anthropic.adapter";
import { createOpenAiCompatibleChatModel } from "./adapters/openai-compatible.adapter";
import {
  ChatModelPort,
  ChatRequest,
  ChatResult,
  ModelCallError,
  ModelStreamChunk,
  NoActiveScopeError,
} from "./chat-model.port";

/** Provider-neutral connection settings needed to build a port. */
export interface ChatModelConfig {
  provider?: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Builds a ChatModelPort for the connection bound to a consumer scope (ADR-006).
 * The scope→connection binding is read on every resolution so admin-side changes
 * (bind/unbind, switch connection) take effect on the next call without a restart.
 * The connection's provider protocol decides which adapter factory handles it.
 *
 * Every returned port is wrapped in the provider-level health decorator: each
 * call's terminal outcome (success, or a classified failure; user aborts excluded)
 * is folded into the connection's health snapshot. Same decorator used by the
 * periodic status probe, so health coverage is uniform across all consumers.
 */
@Injectable()
export class ChatModelResolver {
  constructor(private readonly connections: LlmConnectionService) {}

  async resolve(scope: string): Promise<ChatModelPort> {
    const connection = await this.connections.findByScope(scope);
    if (!connection) {
      throw new NoActiveScopeError(scope);
    }
    return this.buildPort(connection);
  }

  /**
   * Builds a ChatModelPort for a specific connection (by ID), bypassing scope
   * resolution. Used by the connection test endpoint so any connection — bound
   * or not — can be connectivity-tested through the same adapter path.
   */
  async resolveById(id: string): Promise<ChatModelPort> {
    const all = await this.connections.listAll();
    const connection = all.find((c) => c.id === id);
    if (!connection) {
      throw new NotFoundException("LLM connection not found.");
    }
    return this.buildPort(connection);
  }

  private buildPort(connection: LlmConnectionRecord): ChatModelPort {
    return withHealthTracking(this.createPort(connection), connection.id, (outcome) =>
      this.connections.recordModelCallOutcome(outcome),
    );
  }

  /**
   * Builds a port for a configuration that is not persisted yet (the admin
   * create/test dialog). No health tracking: there is no connection row to
   * fold the outcome into.
   */
  createDraftPort(config: ChatModelConfig): ChatModelPort {
    return this.createPort(config);
  }

  private createPort(config: ChatModelConfig): ChatModelPort {
    return config.provider === ANTHROPIC_PROVIDER
      ? createAnthropicChatModel({
          model: config.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl || undefined,
        })
      : createOpenAiCompatibleChatModel({
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        });
  }
}

/**
 * Decorates a port so every complete/stream terminal outcome is reported
 * fire-and-forget. A stream counts as successful only when fully consumed;
 * aborts surface as an "aborted" ModelCallError and are never recorded.
 */
function withHealthTracking(
  port: ChatModelPort,
  connectionId: string,
  record: (outcome: ModelCallOutcome) => void,
): ChatModelPort {
  const recordFailure = (error: unknown): void => {
    if (error instanceof ModelCallError && error.category !== "aborted") {
      record({
        connectionId,
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
        record({ connectionId, success: true });
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
        record({ connectionId, success: true });
      } catch (error) {
        recordFailure(error);
        throw error;
      }
    },
  };
}
