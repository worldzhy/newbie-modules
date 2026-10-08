/**
 * Redaction + bounding helpers for anything derived from model-produced
 * tool arguments that may surface in logs or timeline summaries (FR-29).
 */

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|credential|authorization)/i;
const MASK = "***redacted***";

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? MASK : redactValue(child);
    }
    return out;
  }
  return value;
}

/** Produces a redacted, single-line JSON preview capped at `limit` characters. */
export function summarizeForLog(value: unknown, limit = 300): string {
  let text: string;
  try {
    text = JSON.stringify(redactValue(value));
  } catch {
    text = "[unserializable arguments]";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
