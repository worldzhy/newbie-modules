/** Longest redirect path accepted; anything longer is dropped, not truncated. */
export const MAX_REDIRECT_PATH_LENGTH = 2048;

/**
 * Whether a value is a safe same-origin relative path to carry across an OAuth
 * handshake and hand back to the frontend as a post-login destination.
 *
 * The value arrives in the start request's query string, so it is never
 * trusted. The rules mirror the frontend's `isSafeInternalPath`: only
 * "/"-rooted paths, no protocol-relative "//", and no backslash (browsers
 * normalise `/\evil.com` into `//evil.com`). Control characters are rejected
 * too, because a newline would make cookie serialisation throw. Anything that
 * fails is dropped rather than repaired, and the frontend falls back to the
 * dashboard root.
 */
export function isSafeRedirectPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REDIRECT_PATH_LENGTH) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return true;
}
