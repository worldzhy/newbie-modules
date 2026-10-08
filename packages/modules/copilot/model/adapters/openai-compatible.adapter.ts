/**
 * ChatModelPort adapter for OpenAI-compatible chat completion endpoints
 * (DeepSeek, Qwen, Kimi, OpenRouter, self-hosted vLLM/Ollama, ...).
 *
 * Vendor identity is a database record (CopilotModel), not a code unit:
 * every provider speaking this protocol is supported with zero new code.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ChatModelPort } from "../../kernel/chat-model.port";
import { createSdkChatModel } from "./ai-sdk.bridge";

export interface OpenAiCompatibleChatModelConfig {
  /** Upstream model identifier, e.g. deepseek-chat. */
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function createOpenAiCompatibleChatModel(
  config: OpenAiCompatibleChatModelConfig,
): ChatModelPort {
  const provider = createOpenAICompatible({
    name: "copilot-active-model",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  return createSdkChatModel(config.model, provider.languageModel(config.model));
}
