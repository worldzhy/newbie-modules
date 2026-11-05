/**
 * Dead constants sunk back into code (ADR-033): these values were previously
 * declared in the manifest `config-service` block but are not environment
 * dependent, so they live here instead of the generated consumer config.
 */

/** Fixed rate-limiter budgets for the security module's five buckets. */
export const SECURITY_RATE_LIMITER = {
  ipLoginLimiter: { points: 10, durationSeconds: 600 },
  userLoginLimiter: { points: 5, durationSeconds: 600 },
  ipAccessLimiter: { points: 20, durationSeconds: 60 },
  installationLimiter: { points: 120, durationSeconds: 60 },
  totpLoginLimiter: { points: 5, durationSeconds: 300 },
} as const;

/** Fixed JWT lifetimes; secrets remain environment-provided via config. */
export const SECURITY_TOKEN_EXPIRES_IN = {
  userAccess: "10m",
  userRefresh: "30d",
} as const;
