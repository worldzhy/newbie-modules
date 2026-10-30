import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Installation credential convergence contract (ADR-019).
 *
 * The 2026-10 audit found the sixth collector had copied the token mechanism
 * again, drifting on revocation semantics and audit coverage. Sharing the
 * primitives is only durable if a new collector cannot quietly mint its own
 * token: this scan rejects the known spellings of the mechanism — `randomUUID(`,
 * `createHash("sha256")`, a `\d{8}-…` or `[0-9a-f]{8}-…` UUID regex literal, and
 * any `tokenHash:` column written without importing the shared primitives.
 *
 * The scan is a convention guard, not a proof: a collector minting tokens with
 * `randomBytes`/HMAC and storing them under a differently named column would
 * slip through. Keep the credential column named `tokenHash` and review new
 * collectors for that pattern.
 *
 * Adding a collector does NOT require editing this file — the scan walks every
 * collector directory that is present, so a new module is covered on assembly.
 */

const MODULES_DIR = join(__dirname, "..", "..");

const COLLECTOR_MODULES = ["heartbeat", "health", "module-hub", "backend-monitor", "web-monitor", "work-evaluation"];

const PRIMITIVES_IMPORT_PATTERN = /@modules\/security\/installation\//;
const TOKEN_COLUMN_ASSIGNMENT_PATTERN = /\btokenHash\s*:/;
const TOKEN_GENERATION_PATTERN = /randomUUID\(/;
const TOKEN_HASHING_PATTERN = /createHash\(\s*["']sha256["']\s*\)/;
/** `\d{8}-\d{4}-…` written as a regex literal. */
const UUID_TOKEN_ESCAPE_PATTERN = /\\d\{8\}-\\d\{4\}-\\d\{4\}/;
/** `[0-9a-f]{8}-[0-9a-f]{4}…` character-class spelling of the same shape. */
const UUID_TOKEN_CHARACTER_CLASS_PATTERN = /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/i;

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

/** Guards one collector source file against re-implementing the mechanism. */
function assertCollectorSource(source: string, file: string): void {
  // Only scan files that actually touch installation credential mechanics.
  // A collector's business code (e.g. work-evaluation's blind subject IDs)
  // may legitimately use randomUUID/createHash for non-token purposes.
  const TOUCHES_INSTALLATION_PATTERN =
    /tokenHash|issueInstallationCredential|hashInstallationToken|isInstallationToken|installationCredential|credentialSecret/;
  if (!TOUCHES_INSTALLATION_PATTERN.test(source)) return;

  assert.doesNotMatch(
    source,
    TOKEN_GENERATION_PATTERN,
    `${file} generates its own token; use issueInstallationCredential() from @modules/security/installation (ADR-019).`,
  );
  assert.doesNotMatch(
    source,
    TOKEN_HASHING_PATTERN,
    `${file} hashes tokens itself; use hashInstallationToken() from @modules/security/installation (ADR-019).`,
  );
  assert.doesNotMatch(
    source,
    UUID_TOKEN_ESCAPE_PATTERN,
    `${file} redefines the token format; use isInstallationTokenWellFormed() from @modules/security/installation (ADR-019).`,
  );
  assert.doesNotMatch(
    source,
    UUID_TOKEN_CHARACTER_CLASS_PATTERN,
    `${file} redefines the token format; use isInstallationTokenWellFormed() from @modules/security/installation (ADR-019).`,
  );
  if (!TOKEN_COLUMN_ASSIGNMENT_PATTERN.test(source)) return;
  assert.match(
    source,
    PRIMITIVES_IMPORT_PATTERN,
    `${file} stores a token hash without importing the shared credential primitives (ADR-019).`,
  );
}

describe("installation credential convergence (ADR-019)", () => {
  for (const moduleKey of COLLECTOR_MODULES) {
    const moduleDir = join(MODULES_DIR, moduleKey);

    it(`${moduleKey}: no self-implemented token mechanism`, () => {
      // A consumer may not assemble every collector; absence is not a failure.
      if (!existsSync(moduleDir)) return;

      for (const file of listTypeScriptFiles(moduleDir)) {
        assertCollectorSource(readFileSync(file, "utf8"), file);
      }
    });
  }

  it("detects every mechanism the scan claims to cover", () => {
    // Each sample carries an installation-credential clue so TOUCHES_INSTALLATION_PATTERN
    // routes it into the full scan (we're testing the scan machinery here,
    // not the route decision itself).
    assert.throws(
      () => assertCollectorSource("const tokenHash = randomUUID();", "sample.ts"),
      /generates its own token/,
    );
    assert.throws(() => assertCollectorSource('const tokenHash = createHash("sha256");', "sample.ts"), /hashes tokens/);
    assert.throws(
      () => assertCollectorSource("const installationCredential = /^\\d{8}-\\d{4}-\\d{4}/;", "sample.ts"),
      /redefines/,
    );
    assert.throws(
      () => assertCollectorSource("const installationCredential = /^[0-9a-f]{8}-[0-9a-f]{4}/i;", "sample.ts"),
      /redefines/,
    );
    assert.throws(() => assertCollectorSource("const data = { tokenHash: value };", "sample.ts"), /without importing/);
    assert.doesNotThrow(() =>
      assertCollectorSource(
        'import { hashInstallationToken } from "@modules/security/installation/installation-credential";\nconst data = { tokenHash: hashInstallationToken(token) };',
        "sample.ts",
      ),
    );
  });
});
