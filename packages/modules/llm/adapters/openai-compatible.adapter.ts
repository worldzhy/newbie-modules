/**
 * ChatModelPort adapter for OpenAI-compatible chat completion endpoints
 * (DeepSeek, Qwen, Kimi, OpenRouter, self-hosted vLLM/Ollama, ...).
 *
 * Vendor identity is a database record (LlmModel), not a code unit:
 * every provider speaking this protocol is supported with zero new code.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatModelPort } from "../chat-model.port";
import { createSdkChatModel } from "./ai-sdk.bridge";

export interface OpenAiCompatibleChatModelConfig {
  /** Upstream model identifier, e.g. deepseek-chat. */
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function createOpenAiCompatibleChatModel(config: OpenAiCompatibleChatModelConfig): ChatModelPort {
  const provider = createOpenAICompatible({
    name: "llm-model",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  return createSdkChatModel(config.model, provider.languageModel(config.model), {
    supportsJsonResponseFormat: true,
  });
}
