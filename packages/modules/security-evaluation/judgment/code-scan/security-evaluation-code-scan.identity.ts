import { createHash } from "node:crypto";

/**
 * Identity helpers for the CODE_SCAN judgment (ADR-054), kept pure so the
 * stability of finding fingerprints is testable without a database.
 */

/** Manifest item id of one scanned file: `code-scan:<path>`. */
export function codeScanEvidenceId(path: string): string {
  return `code-scan:${path}`;
}

/** SHA-256 of the full file content; the verdict cache key's freshness dimension. */
export function codeScanContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Stable finding identity (ADR-054 clause 5): sha256 over
 * "code-scan" + criterionKey + path + symbol — deliberately WITHOUT the
 * content hash and without line numbers (those live in finding metadata).
 * Editing the vulnerable code must not change the finding's identity,
 * otherwise a human suppression would be lost with the old fingerprint.
 */
export function codeScanFingerprint(criterionKey: string, path: string, symbol?: string | null): string {
  const parts = ["code-scan", criterionKey, path];
  if (symbol) parts.push(symbol);
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".rs": "rust",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".sql": "sql",
  ".prisma": "prisma",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".sh": "shell",
};

/** Display language derived from the file extension; undefined when unknown. */
export function codeScanLanguage(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  return LANGUAGE_BY_EXTENSION[path.slice(dot).toLowerCase()];
}
