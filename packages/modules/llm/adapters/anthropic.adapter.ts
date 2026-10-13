/**
 * ChatModelPort adapter for the Anthropic Messages API (Claude models).
 *
 * Unlike the OpenAI-compatible family this protocol cannot be reached via
 * /chat/completions, hence a separate provider package and adapter.
 * baseUrl is optional: omit it for the official api.anthropic.com endpoint,
 * set it when routing Anthropic traffic through a compatible gateway.
 *
 * JSON mode (`responseFormat: "json"`) is declared unsupported: the adapter
 * rejects such requests with a "bad-request" ModelCallError instead of
 * silently degrading to free-form text.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { ChatModelPort } from "../chat-model.port";
import { createSdkChatModel } from "./ai-sdk.bridge";

export interface AnthropicChatModelConfig {
  /** Upstream model identifier, e.g. claude-sonnet-4-5. */
  model: string;
  apiKey: string;
  /** Custom gateway URL; empty/undefined uses https://api.anthropic.com. */
  baseUrl?: string;
}

export function createAnthropicChatModel(config: AnthropicChatModelConfig): ChatModelPort {
  const provider = createAnthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });
  return createSdkChatModel(config.model, provider.languageModel(config.model), {
    supportsJsonResponseFormat: false,
  });
}
