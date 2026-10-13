/**
 * Current-state model health seam. The kernel emits one outcome per model
 * call (success or classified failure) from the same single point that emits
 * the model_call audit entry; a module-level implementation folds them into a
 * per-record snapshot. Call aborts are filtered by the runner, so every
 * emitted failure is a genuine model-side problem, never a user cancellation.
 *
 * Implementations must be fire-and-forget: they must never throw into the
 * run loop and must never block streaming.
 */

export interface ModelCallOutcome {
  /** Persistence id of the model record the call ran against. */
  modelRecordId: string;
  success: boolean;
  /** Normalized failure category; present on failure only. */
  errorCategory?: string;
  /** Upstream failure message; present on failure only. */
  errorMessage?: string;
}

export interface ModelHealthSink {
  recordModelCallOutcome(outcome: ModelCallOutcome): void;
}

/** Default sink used when no health adapter is wired: health stays opt-in. */
export const NOOP_MODEL_HEALTH_SINK: ModelHealthSink = {
  recordModelCallOutcome: () => undefined,
};
