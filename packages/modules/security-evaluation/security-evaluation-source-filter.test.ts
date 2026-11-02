import assert from "node:assert/strict";
import { test } from "node:test";

import { SecurityEvaluationController } from "./security-evaluation.controller";
import { SECURITY_EVALUATION_SUBJECT_KINDS } from "./security-evaluation.constants";

/**
 * Read-path contract test for the ADR-039 provenance filter.
 *
 * The query `scopeType` / `scopeId` pair is not an authorization boundary: every
 * read is the platform view, optionally narrowed to the subjects that the named
 * source submitted. This test pins the translation the controller performs —
 * resolve the source filter on the provenance table, then hand the subject set
 * to the underlying list service — including the two edge cases that would
 * silently widen a request: an absent filter (platform view) and a filter that
 * matches nothing (empty set, never `undefined`).
 */

interface FindingsInput {
  subjectIds?: string[];
  subjectId?: string;
  runId?: string;
  evaluationKey?: string;
  status?: string;
  severity?: string;
  page?: number;
  pageSize?: number;
}

interface RunsInput {
  subjectIds?: string[];
  subjectId?: string;
  ruleSetVersionId?: string;
  page?: number;
  pageSize?: number;
}

interface SeenCalls {
  sourceFilters: Array<{ scopeType?: string; scopeId?: string }>;
  assets: Array<Record<string, unknown>>;
  runs: RunsInput[];
  findings: FindingsInput[];
  reports: Array<string[] | null>;
}

function createController(subjectIds: string[] | null) {
  const seen: SeenCalls = { sourceFilters: [], assets: [], runs: [], findings: [], reports: [] };

  const assets = {
    listSubjectIdsBySource: async (filter: { scopeType?: string; scopeId?: string }) => {
      seen.sourceFilters.push(filter);
      return subjectIds;
    },
    listAssets: async (input: Record<string, unknown>) => {
      seen.assets.push(input);
      return { items: [], countOfTotal: 0, page: 1, pageSize: 20 };
    },
    listKnowledgeItems: async () => ({ items: [], countOfTotal: 0, page: 1, pageSize: 20 }),
  };
  const runs = {
    listRuns: async (input: RunsInput) => {
      seen.runs.push(input);
      return { items: [], countOfTotal: 0, page: 1, pageSize: 20 };
    },
  };
  const findings = {
    listFindings: async (input: FindingsInput) => {
      seen.findings.push(input);
      return { items: [], countOfTotal: 0, page: 1, pageSize: 20 };
    },
  };
  const reports = {
    getReport: async (ids: string[] | null) => {
      seen.reports.push(ids);
      return {};
    },
  };

  return {
    controller: new SecurityEvaluationController(assets as never, runs as never, findings as never, reports as never),
    seen,
  };
}

test("findings, runs and the report narrow to the subjects the source contributed", async () => {
  for (const subjectIds of [["s-1", "s-2"], []] as Array<string[] | null>) {
    const { controller, seen } = createController(subjectIds);

    await controller.listFindings({ scopeType: "project", scopeId: "p-1", page: 1, pageSize: 20 });
    await controller.listRuns({ scopeType: "project", scopeId: "p-1", page: 1, pageSize: 20 });
    await controller.getReport({ scopeType: "project", scopeId: "p-1" });

    assert.deepEqual(
      seen.sourceFilters.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
      [
        { scopeType: "project", scopeId: "p-1" },
        { scopeType: "project", scopeId: "p-1" },
        { scopeType: "project", scopeId: "p-1" },
      ],
    );
    assert.deepEqual(seen.findings[0], {
      subjectIds,
      subjectId: undefined,
      runId: undefined,
      evaluationKey: undefined,
      status: undefined,
      severity: undefined,
      page: 1,
      pageSize: 20,
    });
    assert.deepEqual(seen.runs[0], {
      subjectIds,
      subjectId: undefined,
      ruleSetVersionId: undefined,
      page: 1,
      pageSize: 20,
    });
    assert.deepEqual(seen.reports[0], subjectIds);
  }
});

test("an absent filter is the platform view, not an empty set", async () => {
  const { controller, seen } = createController(null);

  await controller.listFindings({ page: 1, pageSize: 20 });
  await controller.listRuns({ page: 1, pageSize: 20 });
  await controller.getReport({});

  assert.ok(seen.sourceFilters.every((filter) => filter.scopeType === undefined && filter.scopeId === undefined));
  // `undefined` means "no subject narrowing"; an empty array would hide all rows.
  assert.equal(seen.findings[0].subjectIds, undefined);
  assert.equal(seen.runs[0].subjectIds, undefined);
  assert.equal(seen.reports[0], null);
});

test("an explicit subject id bypasses provenance resolution", async () => {
  const { controller, seen } = createController(["never-used"]);

  await controller.listFindings({ subjectId: "s-explicit", page: 1, pageSize: 20 });
  await controller.listRuns({ subjectId: "s-explicit", page: 1, pageSize: 20 });

  assert.deepEqual(seen.sourceFilters, []);
  assert.equal(seen.findings[0].subjectId, "s-explicit");
  assert.equal(seen.findings[0].subjectIds, undefined);
  assert.equal(seen.runs[0].subjectId, "s-explicit");
  assert.equal(seen.runs[0].subjectIds, undefined);
});

test("the asset list forwards the provenance filter and the feature's subject kinds", async () => {
  const { controller, seen } = createController(null);

  await controller.listAssets({ scopeType: "project", scopeId: "p-1", page: 1, pageSize: 20 });

  assert.deepEqual(seen.assets[0], {
    scopeType: "project",
    scopeId: "p-1",
    kinds: [...SECURITY_EVALUATION_SUBJECT_KINDS],
    page: 1,
    pageSize: 20,
  });
});
