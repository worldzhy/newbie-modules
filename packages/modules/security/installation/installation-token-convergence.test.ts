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
 * token: this scan fails as soon as a collector reintroduces token generation,
 * token hashing or a local UUID token regex.
 *
 * Adding a collector does NOT require editing this file — the scan walks every
 * collector directory that is present, so a new module is covered on assembly.
 */

const MODULES_DIR = join(__dirname, "..", "..");

const COLLECTOR_MODULES = ["heartbeat", "health", "module-hub", "backend-monitor", "web-monitor", "people-evaluation"];

const PRIMITIVES_IMPORT_PATTERN = /@modules\/security\/installation\//;
const TOKEN_COLUMN_ASSIGNMENT_PATTERN = /\btokenHash\s*:/;
const TOKEN_GENERATION_PATTERN = /randomUUID\(/;
const TOKEN_HASHING_PATTERN = /createHash\(\s*["']sha256["']\s*\)/;
const UUID_TOKEN_LITERAL_PATTERN = /\\d\{8\}-\\d\{4\}-\\d\{4\}/;

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

describe("installation credential convergence (ADR-019)", () => {
  for (const moduleKey of COLLECTOR_MODULES) {
    const moduleDir = join(MODULES_DIR, moduleKey);

    it(`${moduleKey}: no self-generated installation tokens`, () => {
      // A consumer may not assemble every collector; absence is not a failure.
      if (!existsSync(moduleDir)) return;

      for (const file of listTypeScriptFiles(moduleDir)) {
        const source = readFileSync(file, "utf8");
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
          UUID_TOKEN_LITERAL_PATTERN,
          `${file} redefines the token format; use isInstallationTokenWellFormed() from @modules/security/installation (ADR-019).`,
        );
      }
    });

    it(`${moduleKey}: token storage goes through the shared primitives`, () => {
      if (!existsSync(moduleDir)) return;

      for (const file of listTypeScriptFiles(moduleDir)) {
        const source = readFileSync(file, "utf8");
        if (!TOKEN_COLUMN_ASSIGNMENT_PATTERN.test(source)) continue;
        assert.match(
          source,
          PRIMITIVES_IMPORT_PATTERN,
          `${file} stores a token hash without importing the shared credential primitives (ADR-019).`,
        );
      }
    });
  }
});
