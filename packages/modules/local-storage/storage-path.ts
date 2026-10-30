import * as path from "node:path";

/**
 * Storage path hardening.
 *
 * Local file/folder names arrive from the API and were concatenated straight
 * into a filesystem path (`root + "/" + name`), so a name like `../../etc/passwd`
 * escaped the storage root. Names are now validated per segment and the final
 * path is resolved and checked to stay inside the configured root. Kept
 * dependency-free for unit testing.
 */
export class UnsafeFileNameError extends Error {
  constructor(name: string) {
    super(`Unsafe file name: ${JSON.stringify(name)}`);
    this.name = "UnsafeFileNameError";
  }
}

/** A single path segment may not be empty, a traversal token, or contain separators. */
export function assertSafeFileName(name: string): void {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0")
  ) {
    throw new UnsafeFileNameError(name);
  }
}

/**
 * Joins validated segments under `root` and guarantees the result stays inside
 * it. Throws rather than returning a path outside the root.
 */
export function resolveStoragePath(root: string, segments: string[]): string {
  if (segments.length === 0) {
    throw new UnsafeFileNameError("");
  }
  for (const segment of segments) {
    assertSafeFileName(segment);
  }

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...segments);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new UnsafeFileNameError(segments.join("/"));
  }
  return resolved;
}
