/**
 * Drill-down output scrubbing (ADR-024): the agent reads evidence under a blind
 * subject id, so anything a tool returns must neither leak credentials nor
 * re-identify the subject. The secret patterns mirror the collector-side
 * scrubber (devbie/packages/worklog/src/redact.ts) — keep the two lists
 * aligned when either changes.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp; keepKeyName?: boolean }[] = [
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "github-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "private-key-block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  {
    name: "assigned-secret",
    // The optional quote after the key name covers JSON payloads such as
    // `"password": "hunter2"`, not just `password=hunter2`.
    pattern: /\b(password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?[^\s"',}]{6,}/gi,
    keepKeyName: true,
  },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

export const REDACTED = "[REDACTED]";
export const SUBJECT_MASK = "[subject]";

/**
 * Home-directory prefixes embed the operating system's login name, which no
 * account field carries: external identities hold platform accounts and the
 * profile has display fields only. The prefix shape is a structural OS fact,
 * so the login segment is masked by form rather than by an inferred token —
 * an inferred name cannot be proven correct, and a short or generic one
 * ("admin", "root") would destroy ordinary text. Runs before the identity
 * tokens so a path segment is never partly consumed by a name token.
 */
const HOME_PATH_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // POSIX: /Users/<login>/... (macOS) and /home/<login>/... (Linux).
  {
    pattern: /(?<![A-Za-z0-9._~%-])(\/(?:Users|home)\/)([A-Za-z0-9._-]+)(?=[/\\]|["'`\s,;:)\]}]|$)/gi,
    replacement: `$1${SUBJECT_MASK}`,
  },
  // Windows: C:\Users\<login>\... (the separator after the login is required
  // so a prose sentence is never mistaken for a profile path).
  {
    pattern: /(?<![A-Za-z0-9._-])([A-Za-z]:\\Users\\)([^\\/:*?"<>|\r\n]+)(?=[\\/])/gi,
    replacement: `$1${SUBJECT_MASK}`,
  },
];

/**
 * Builds a scrubber for one evaluatee's drill-down output. Identity tokens are
 * the member's registered emails, linked-account display names and profile
 * name; each occurrence is replaced with a stable mask so the text stays
 * readable without revealing who the subject is. Home-directory path segments
 * are masked by shape, and secret patterns then apply regardless of whose
 * secret they are.
 */
export function createDrillRedactor(identityTokens: Set<string>): (text: string) => string {
  const emailTokens: string[] = [];
  const literalTokens: string[] = [];
  for (const token of identityTokens) {
    if (token.includes("@")) {
      emailTokens.push(token);
    } else {
      literalTokens.push(token);
    }
  }
  // Longest first so a shorter token never partially masks a longer one.
  literalTokens.sort((left, right) => right.length - left.length);

  return (text: string): string => {
    let output = text;
    for (const { pattern, replacement } of HOME_PATH_PATTERNS) {
      output = output.replace(pattern, replacement);
    }
    for (const token of literalTokens) {
      output = output.split(token).join(SUBJECT_MASK);
    }
    for (const token of emailTokens) {
      output = output.replace(new RegExp(escapeRegExp(token), "gi"), SUBJECT_MASK);
    }
    for (const { pattern, keepKeyName } of SECRET_PATTERNS) {
      output = output.replace(pattern, (match) => {
        // Keep the key name for the "assigned-secret" case so the reader knows
        // what was removed; everything else is replaced wholesale.
        if (keepKeyName) {
          const separator = match.search(/[:=]/);
          const keyName = separator > 0 ? match.slice(0, separator).replace(/["']/g, "").trim() : "";
          return keyName.length > 0 ? `${keyName}=${REDACTED}` : REDACTED;
        }
        return REDACTED;
      });
    }
    return output;
  };
}

/**
 * Applies the scrubber to every string inside a tool result, so nested payloads
 * (message bodies, document excerpts) are covered without each tool remembering
 * to call it — one forgotten field would leak a name.
 */
export function redactDeep<T>(value: T, redact: (text: string) => string): T {
  return walk(value, redact) as T;
}

function walk(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, redact));
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = walk(item, redact);
    }
    return output;
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
