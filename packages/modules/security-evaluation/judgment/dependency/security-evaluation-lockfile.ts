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

const YARN_ENTRY_HEADER = /^[^\s#].*:$/;
const YARN_ENTRY_VERSION = /^\s+version\s+"([^"]+)"/;

/**
 * Parse a yarn classic (v1) lockfile. Each entry is a header listing one or
 * more selectors, followed by its resolved fields:
 *
 *   lodash@^4.17.0, lodash@~4.17.20:
 *     version "4.17.20"
 *
 * The same name@version reachable through several selectors is one installed
 * dependency. yarn v1 records no dev flag, so `devOnlyNames` (the manifest's
 * devDependencies minus its dependencies) approximates it: a package declared
 * only as a development dependency is development-only, while a transitive
 * dev dependency stays "production" — that overstates exposure instead of
 * hiding it. Entries without a resolved version (git, file, patch, alias
 * selectors) carry no exact version to match against OSV and are skipped.
 */
export function parseYarnLock(content: string, devOnlyNames: ReadonlySet<string> = new Set()): LockedPackage[] {
  if (/^__metadata:/m.test(content)) {
    throw new Error(
      `Unsupported ${SECURITY_EVALUATION_ECOSYSTEM_NPM} lockfile format: yarn berry (v2+) is not supported, yarn classic v1 required.`,
    );
  }

  const byKey = new Map<string, LockedPackage>();
  let names: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (YARN_ENTRY_HEADER.test(line)) {
      names = parseYarnSelectors(line.slice(0, -1));
      continue;
    }
    const version = YARN_ENTRY_VERSION.exec(line)?.[1];
    if (!version) continue;
    for (const name of names) {
      const key = `${name}@${version}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { name, version, dev: devOnlyNames.has(name) });
    }
    names = [];
  }
  return [...byKey.values()];
}

function parseYarnSelectors(header: string): string[] {
  return header
    .split(",")
    .map((selector) => selector.trim().replace(/^"|"$/g, ""))
    .map(yarnSelectorName)
    .filter((name): name is string => name !== null);
}

/** The package a v1 selector resolves, or null for alias/protocol selectors. */
function yarnSelectorName(selector: string): string | null {
  if (!selector || selector.includes("npm:") || selector.includes(":/")) return null;
  const at = selector.indexOf("@", selector.startsWith("@") ? 1 : 0);
  return at > 0 ? selector.slice(0, at) : null;
}

/** Direct dependency names declared by a manifest. */
export interface ManifestDependencies {
  /** Every direct dependency name, production and development, sorted. */
  declared: string[];
  /** Development-only names: declared in devDependencies and not in dependencies. */
  devOnly: string[];
}

/**
 * Dependencies declared in package.json (direct only). `declared` reports what
 * the lockfile could not link back to an installed knowledge item — a declared
 * name without a resolved version is a coverage gap, not a silent omission.
 */
export function parseManifestDependencies(content: string): ManifestDependencies {
  const manifest = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  const production = new Set(Object.keys(manifest?.dependencies ?? {}));
  const development = Object.keys(manifest?.devDependencies ?? {});
  const declared = [...new Set([...production, ...development])].sort((left, right) => left.localeCompare(right));
  return { declared, devOnly: development.filter((name) => !production.has(name)).sort((a, b) => a.localeCompare(b)) };
}
