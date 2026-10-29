import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvaluationRuleSetVersionRef, EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

import type { SecurityEvaluationAssetService } from "./assets/security-evaluation-asset.service";
import { SecurityEvaluationEvidenceProvider } from "./evidence/security-evaluation-evidence.provider";
import type { RepositoryAccess } from "./ports/repository-access.port";

/**
 * Behavior-level tests for evidence collection (ADR-022 D3, ADR-020 D5.2):
 * a repository whose lockfile cannot be read is a failed run rather than a
 * clean one, and dependencies declared in package.json without a resolved
 * installed item are reported as declaredUnlinked instead of being counted
 * clean.
 */

const subject: EvaluationSubjectRef = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "repository",
  scopeType: "project",
  scopeId: "22222222-2222-4222-8222-222222222222",
  subjectKey: "application-1",
  displayName: "nightwatch-backend",
};

const ruleSetVersion: EvaluationRuleSetVersionRef = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "repository",
  evaluationKey: "npm-osv",
  version: "v1",
};

const LOCKFILE = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { name: "example" },
    "node_modules/lodash": { version: "4.17.20" },
    "node_modules/@types/node": { version: "22.0.0", dev: true },
  },
});

function fakeAssets() {
  const writes = { items: 0, touched: 0 };
  const assets = {
    ensureAsset: async () => ({ id: "asset-1" }),
    upsertNpmPackageKnowledgeItems: async () => {
      writes.items += 1;
    },
    touchObserved: async () => {
      writes.touched += 1;
    },
  };
  return { assets: assets as unknown as SecurityEvaluationAssetService, writes };
}

function fakeRepositoryAccess(files: Record<string, string>): RepositoryAccess {
  return {
    getFile: async (_subject: EvaluationSubjectRef, path: string) => files[path] ?? null,
  } as RepositoryAccess;
}

test("a repository with no supported lockfile fails the run instead of reporting a clean one", async () => {
  const { assets, writes } = fakeAssets();
  const provider = new SecurityEvaluationEvidenceProvider(assets, fakeRepositoryAccess({}));

  await assert.rejects(() => provider.collect(subject, ruleSetVersion), /No supported lockfile/);
  // Nothing was persisted: the asset must not look observed after a failed run.
  assert.equal(writes.items, 0);
  assert.equal(writes.touched, 0);
});

test("a legacy lockfile without a packages map fails the run with its own reason", async () => {
  const { assets } = fakeAssets();
  const provider = new SecurityEvaluationEvidenceProvider(
    assets,
    fakeRepositoryAccess({ "package-lock.json": JSON.stringify({ lockfileVersion: 1, dependencies: {} }) }),
  );

  await assert.rejects(() => provider.collect(subject, ruleSetVersion), /missing packages map/);
});

test("a lockfile that resolves no packages fails the run instead of reporting a vacuous clean result", async () => {
  const { assets } = fakeAssets();
  const provider = new SecurityEvaluationEvidenceProvider(
    assets,
    fakeRepositoryAccess({ "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }) }),
  );

  await assert.rejects(() => provider.collect(subject, ruleSetVersion), /resolved no packages/);
});

test("declared dependencies absent from the lockfile are reported as declaredUnlinked", async () => {
  const { assets } = fakeAssets();
  const provider = new SecurityEvaluationEvidenceProvider(
    assets,
    fakeRepositoryAccess({
      "package-lock.json": LOCKFILE,
      "package.json": JSON.stringify({ dependencies: { lodash: "^4.17.0", "left-pad": "^1.3.0" } }),
    }),
  );

  const collection = await provider.collect(subject, ruleSetVersion);

  assert.deepEqual(
    collection.items.map((item) => item.id),
    ["pkg:npm:lodash@4.17.20", "pkg:npm:@types/node@22.0.0"],
  );
  assert.equal(collection.items[1].payload?.isDev, true);
  assert.equal(collection.declaredUnlinked.total, 1);
  assert.deepEqual(collection.declaredUnlinked.items, ["left-pad"]);
  assert.match(collection.declaredUnlinked.note ?? "", /left-pad/);
  assert.equal(collection.skipped.total, 0);
});

test("a host that forgot to bind RepositoryAccess fails loudly instead of collecting nothing", async () => {
  const { assets } = fakeAssets();
  const provider = new SecurityEvaluationEvidenceProvider(assets, undefined);

  await assert.rejects(() => provider.collect(subject, ruleSetVersion), /No RepositoryAccess is bound/);
});
