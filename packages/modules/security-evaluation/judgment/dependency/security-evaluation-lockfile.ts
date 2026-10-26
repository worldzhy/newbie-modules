import { SECURITY_EVALUATION_ECOSYSTEM_NPM } from "../../security-evaluation.constants";

/** A package resolved by the lockfile: an exact name at an exact version. */
export interface LockedPackage {
  name: string;
  version: string;
  /** True when the lockfile marks the package as a development-only dependency. */
  dev: boolean;
}

interface LockfilePackageEntry {
  version?: string;
  dev?: boolean;
}

const NODE_MODULES_MARKER = "node_modules/";

/**
 * Parse the `packages` map of package-lock.json (lockfileVersion 2+). That map
 * covers the full transitive tree with exact versions — package.json alone only
 * carries ranges and cannot be matched against vulnerability ranges.
 *
 * Entries are deduplicated by `name@version`: the same package installed under
 * several node_modules paths is one installed dependency, not several.
 */
export function parsePackageLock(content: string): LockedPackage[] {
  const lock = JSON.parse(content) as { packages?: Record<string, LockfilePackageEntry> } | null;
  const packages = lock?.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error(
      `Unsupported ${SECURITY_EVALUATION_ECOSYSTEM_NPM} lockfile format: missing packages map (lockfileVersion 2+ required).`,
    );
  }

  const byKey = new Map<string, LockedPackage>();
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) continue; // the root entry describes the project itself
    const markerIndex = path.lastIndexOf(NODE_MODULES_MARKER);
    if (markerIndex === -1 || !entry?.version) continue;
    const name = path.slice(markerIndex + NODE_MODULES_MARKER.length);
    const key = `${name}@${entry.version}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { name, version: entry.version, dev: Boolean(entry.dev) });
  }
  return [...byKey.values()];
}

/**
 * Dependencies declared in package.json (direct only). Used to report what the
 * lockfile could not link back to an installed fact — declared names without a
 * resolved version are a coverage gap, not a silent omission.
 */
export function parseDeclaredDependencies(content: string): string[] {
  const manifest = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  const names = new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
  return [...names].sort((left, right) => left.localeCompare(right));
}
