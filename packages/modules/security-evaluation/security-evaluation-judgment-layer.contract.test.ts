import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Judgment-layer isolation contract (ADR-037 D9.4, ADR-045).
 *
 * The judgment directory is the domain-policy layer: it consumes `input.evidence`
 * and produces verdicts/findings, never persistence. This scan upgrades that
 * rule from prose to a gate — a new mechanism cannot quietly inject Prisma.
 * The Prisma adapter for the negative cache therefore lives outside `judgment/`.
 */
const JUDGMENT_DIR = join(__dirname, "judgment");

const PRISMA_DEPENDENCY = /@devbie\/newbie\/prisma|@generated\/prisma|PrismaService/;

function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listTypeScriptFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

test("no judgment source imports Prisma", () => {
  for (const file of listTypeScriptFiles(JUDGMENT_DIR)) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      PRISMA_DEPENDENCY,
      `${file} imports Prisma; judgment code must consume input.evidence only (ADR-037 D9.4, ADR-045).`,
    );
  }
});
