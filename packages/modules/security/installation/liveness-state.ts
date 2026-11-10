/**
 * Single source of the four-state liveness vocabulary (ADR-041): shared by
 * reporter modules (health) and the host's application-level liveness read
 * model. The const object doubles as the Swagger enum on the host DTO, so
 * the wire contract and the module-internal derivation can never drift.
 *
 * FRONTEND reporters (heartbeat, frontend-monitor) never report "degraded" (no
 * dependency visibility); health adds it for a process that is alive but
 * reports a failing dependency.
 */
// Declaration order matches the historical wire order of the previous
// host-side TS enum, keeping the generated Swagger enum byte-identical.
export const LivenessState = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  OFFLINE: "offline",
  UNKNOWN: "unknown",
} as const;

export type LivenessState = (typeof LivenessState)[keyof typeof LivenessState];

const LIVENESS_STATE_ORDER: Record<LivenessState, number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  offline: 3,
};

/** Return the worse of two liveness states (offline > degraded > healthy > unknown). */
export function worseLivenessState(a: LivenessState, b: LivenessState): LivenessState {
  return LIVENESS_STATE_ORDER[a] >= LIVENESS_STATE_ORDER[b] ? a : b;
}
