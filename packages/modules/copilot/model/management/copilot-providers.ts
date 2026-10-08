/**
 * Chat provider protocols supported by the Copilot model config.
 *
 * A provider is a wire protocol, not a vendor: every OpenAI-compatible
 * vendor (DeepSeek, Qwen, Kimi, gateways) is one record under
 * "openai-compatible", while Anthropic's Messages API needs its own adapter.
 */
export const OPENAI_COMPATIBLE_PROVIDER = "openai-compatible";
export const ANTHROPIC_PROVIDER = "anthropic";

export const COPILOT_PROVIDERS = [OPENAI_COMPATIBLE_PROVIDER, ANTHROPIC_PROVIDER] as const;

/** Official Anthropic endpoint, used when a record leaves baseUrl empty. */
export const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const ANTHROPIC_API_VERSION = "2023-06-01";
