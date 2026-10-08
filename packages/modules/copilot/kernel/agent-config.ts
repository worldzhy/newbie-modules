/**
 * Kernel tuning constants. v1 defaults frozen from OQ-3 (step budget); the
 * timeouts bound upstream/skill latency so a stalled run always settles.
 */

/** Maximum model turns per run before the step-limit circuit opens. */
export const MAX_AGENT_STEPS = 10;

/** Per-model-call timeout; cancellation also honours the caller AbortSignal. */
export const MODEL_TIMEOUT_MS = 60_000;

/** Maximum length of the argument preview embedded in tool-started events. */
export const ARGUMENT_SUMMARY_LIMIT = 300;

/** Per-skill execution timeout (skills perform bounded parameterized reads). */
export const SKILL_TIMEOUT_MS = 30_000;

/** How long a suspended run waits for a confirm decision before auto-denying. */
export const CONFIRMATION_TIMEOUT_MS = 5 * 60_000;

/** Sliding inactivity window for in-memory conversations (OQ-3 default). */
export const CONVERSATION_TTL_MS = 30 * 60_000;

/** How long a finished run's event sequence stays available for idempotent replay. */
export const COMPLETED_RUN_RETENTION_MS = 5 * 60_000;
