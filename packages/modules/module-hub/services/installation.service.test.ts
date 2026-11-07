import assert from "node:assert/strict";
import { test } from "node:test";

import { annotateUpdateAvailability, summarizeHintCoverage } from "./installation.service";

/**
 * Regression guard for the read-time upgrade hint (round23 finding R23-06).
 *
 * The hub derives `updateAvailable` from the release catalog because the CLI
 * snapshot never carries it. The invariant is "never over-report": a pin whose
 * commit date is unknown, or a release that is not strictly newer than the pin,
 * must stay quiet. Downgrading this comparison back to "commits differ" would
 * flag almost every module (most pins sit on an assembly-time HEAD that is
 * newer than the module's own last change).
 */

function release(sourceCommit: string, committedAt: string | null) {
  return { sourceCommit, committedAt: committedAt ? new Date(committedAt) : null };
}

function catalog(entries: Record<string, { sourceCommit: string; committedAt: Date | null }>) {
  return new Map(Object.entries(entries));
}

test("flags a module whose latest release is strictly newer than its pin", () => {
  const actual = annotateUpdateAvailability(
    [{ key: "alpha", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z" }],
    catalog({ alpha: release("release-2", "2026-11-02T00:00:00.000Z") }),
  );

  assert.deepEqual(actual, [
    { key: "alpha", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z", updateAvailable: true },
  ]);
});

test("stays quiet when the pin has no commit date", () => {
  const actual = annotateUpdateAvailability(
    [{ key: "alpha", sourceCommit: "pin-1" }],
    catalog({ alpha: release("release-2", "2026-11-02T00:00:00.000Z") }),
  );

  assert.equal((actual as { updateAvailable?: boolean }[])[0].updateAvailable, false);
});

test("stays quiet when the latest release is not newer than the pin", () => {
  const sameDay = annotateUpdateAvailability(
    [{ key: "alpha", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-02T00:00:00.000Z" }],
    catalog({ alpha: release("release-2", "2026-11-02T00:00:00.000Z") }),
  );
  const older = annotateUpdateAvailability(
    [{ key: "alpha", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-03T00:00:00.000Z" }],
    catalog({ alpha: release("release-2", "2026-11-02T00:00:00.000Z") }),
  );

  assert.equal((sameDay as { updateAvailable?: boolean }[])[0].updateAvailable, false);
  assert.equal((older as { updateAvailable?: boolean }[])[0].updateAvailable, false);
});

test("stays quiet when the pin already is the latest release", () => {
  const actual = annotateUpdateAvailability(
    [{ key: "alpha", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z" }],
    catalog({ alpha: release("pin-1", "2026-11-01T00:00:00.000Z") }),
  );

  assert.equal((actual as { updateAvailable?: boolean }[])[0].updateAvailable, false);
});

test("stays quiet for modules missing from the catalog and keeps the reported flag", () => {
  const actual = annotateUpdateAvailability(
    [
      { key: "unknown", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z" },
      { key: "reported", sourceCommit: "pin-1", updateAvailable: true },
    ],
    catalog({}),
  );

  assert.deepEqual(actual, [
    { key: "unknown", sourceCommit: "pin-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z", updateAvailable: false },
    { key: "reported", sourceCommit: "pin-1", updateAvailable: true },
  ]);
});

test("passes non-array snapshots through untouched", () => {
  assert.equal(annotateUpdateAvailability(null, catalog({})), null);
  assert.deepEqual(annotateUpdateAvailability({ key: "alpha" }, catalog({})), { key: "alpha" });
});

test("summary counts pin dates and catalog hits", () => {
  const latestByKey = catalog({
    alpha: release("r-1", "2026-11-01T00:00:00.000Z"),
    beta: release("r-2", "2026-11-01T00:00:00.000Z"),
  });

  assert.deepEqual(
    summarizeHintCoverage(
      [
        { key: "alpha", sourceCommit: "p-1", sourceCommittedAt: "2026-11-01T00:00:00.000Z" },
        { key: "beta", sourceCommit: "p-2", sourceCommittedAt: "2026-11-01T00:00:00.000Z" },
        { key: "gamma", sourceCommit: "p-3" },
      ],
      latestByKey,
    ),
    { total: 3, dated: 2, catalogued: 2 },
  );
});

test("summary of an empty or missing snapshot is all zeroes", () => {
  assert.deepEqual(summarizeHintCoverage(null, catalog({})), { total: 0, dated: 0, catalogued: 0 });
  assert.deepEqual(summarizeHintCoverage([], catalog({})), { total: 0, dated: 0, catalogued: 0 });
});
