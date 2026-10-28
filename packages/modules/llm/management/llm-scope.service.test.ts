import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { LlmScopeCatalog, type LlmScopeDefinition } from "./llm-scope-catalog.service";
import { LlmScopeService } from "./llm-scope.service";

/**
 * Behavior tests for the scope catalog and its bindings (ADR-043): the catalog
 * decides which scopes exist, and the admin surface must expose every one of
 * them — bound or not — while refusing typos instead of persisting dead rows.
 */

interface FakeConnection {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface FakeAssignment {
  scope: string;
  connectionId: string;
}

function createHarness(options: {
  connections: FakeConnection[];
  assignments?: FakeAssignment[];
  scopes: LlmScopeDefinition[];
}) {
  const connections = [...options.connections];
  const assignments = new Map((options.assignments ?? []).map((assignment) => [assignment.scope, assignment]));

  const withConnection = (assignment: FakeAssignment) => ({
    ...assignment,
    connection: connections.find((connection) => connection.id === assignment.connectionId),
  });

  const prisma = {
    llmConnection: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        connections.find((connection) => connection.id === where.id) ?? null,
    },
    llmScopeAssignment: {
      findMany: async () => [...assignments.values()].map(withConnection),
      findUnique: async ({ where }: { where: { scope: string } }) => {
        const assignment = assignments.get(where.scope);
        return assignment ? withConnection(assignment) : null;
      },
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { scope: string };
        update: FakeAssignment;
        create: FakeAssignment;
      }) => {
        const existing = assignments.get(where.scope);
        assignments.set(where.scope, existing ? { ...existing, ...update } : create);
      },
      delete: async ({ where }: { where: { scope: string } }) => {
        assignments.delete(where.scope);
      },
    },
  };

  const catalog = new LlmScopeCatalog();
  for (const scope of options.scopes) catalog.register(scope);

  return {
    service: new LlmScopeService(prisma as unknown as PrismaService, catalog),
    assignments,
  };
}

const COPILOT_CONNECTION: FakeConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Production DeepSeek",
  provider: "openai-compatible",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-live",
};

const FALLBACK_CONNECTION: FakeConnection = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Fallback Qwen",
  provider: "openai-compatible",
  model: "qwen-plus",
  baseUrl: "https://dashscope.aliyuncs.com/v1",
  apiKey: "sk-backup",
};

describe("LlmScopeCatalog", () => {
  it("rejects a second registration of the same scope", () => {
    const catalog = new LlmScopeCatalog();
    catalog.register({ scope: "copilot", label: "Copilot" });

    assert.throws(
      () => catalog.register({ scope: "copilot", label: "Another consumer" }),
      /already registered as "Copilot"/,
    );
  });

  it("lists registered scopes in a stable order", () => {
    const catalog = new LlmScopeCatalog();
    catalog.register({ scope: "work-evaluation", label: "Work evaluation" });
    catalog.register({ scope: "analysis", label: "Project data analysis" });
    catalog.register({ scope: "copilot", label: "Copilot" });

    assert.deepEqual(
      catalog.list().map((definition) => definition.scope),
      ["analysis", "copilot", "work-evaluation"],
    );
    assert.equal(catalog.labelOf("copilot"), "Copilot");
    assert.equal(catalog.labelOf("removed-consumer"), "removed-consumer");
  });
});

describe("LlmScopeService", () => {
  it("refuses to bind a scope no consumer registered", async () => {
    const { service, assignments } = createHarness({
      connections: [COPILOT_CONNECTION],
      scopes: [{ scope: "copilot", label: "Copilot" }],
    });

    await assert.rejects(() => service.bind("coplit", COPILOT_CONNECTION.id), BadRequestException);
    assert.equal(assignments.size, 0);
  });

  it("refuses to bind to a connection that does not exist", async () => {
    const { service } = createHarness({
      connections: [COPILOT_CONNECTION],
      scopes: [{ scope: "copilot", label: "Copilot" }],
    });

    await assert.rejects(() => service.bind("copilot", "33333333-3333-4333-8333-333333333333"), NotFoundException);
  });

  it("lists every registered scope, unbound ones included, plus stale assignments", async () => {
    const staleScope = "legacy-consumer";
    const { service } = createHarness({
      connections: [COPILOT_CONNECTION, FALLBACK_CONNECTION],
      assignments: [
        { scope: "copilot", connectionId: COPILOT_CONNECTION.id },
        { scope: staleScope, connectionId: FALLBACK_CONNECTION.id },
      ],
      scopes: [
        { scope: "analysis", label: "Project data analysis" },
        { scope: "copilot", label: "Copilot" },
      ],
    });

    const rows = await service.list();
    assert.deepEqual(
      rows.map((row) => row.scope),
      ["analysis", "copilot", staleScope],
    );

    const [analysis, copilot, stale] = rows;
    assert.equal(analysis.connectionId, null);
    assert.equal(analysis.connectionName, null);
    assert.equal(analysis.label, "Project data analysis");
    assert.equal(copilot.label, "Copilot");
    assert.equal(copilot.connectionName, "Production DeepSeek");
    assert.equal(copilot.connectionModel, "deepseek-chat");
    // A binding whose consumer is gone stays visible so it can be unbound.
    assert.equal(stale.label, staleScope);
    assert.equal(stale.connectionName, "Fallback Qwen");
  });

  it("moves a bound scope to another connection instead of duplicating it", async () => {
    const { service, assignments } = createHarness({
      connections: [COPILOT_CONNECTION, FALLBACK_CONNECTION],
      assignments: [{ scope: "copilot", connectionId: COPILOT_CONNECTION.id }],
      scopes: [{ scope: "copilot", label: "Copilot" }],
    });

    const result = await service.bind("copilot", FALLBACK_CONNECTION.id);

    assert.equal(result.connectionId, FALLBACK_CONNECTION.id);
    assert.equal(result.connectionModel, "qwen-plus");
    assert.equal(assignments.size, 1);
    assert.equal(assignments.get("copilot")?.connectionId, FALLBACK_CONNECTION.id);
  });

  it("unbinds a scope and keeps it listed as unbound", async () => {
    const { service } = createHarness({
      connections: [COPILOT_CONNECTION],
      assignments: [{ scope: "copilot", connectionId: COPILOT_CONNECTION.id }],
      scopes: [{ scope: "copilot", label: "Copilot" }],
    });

    const removed = await service.unbind("copilot");
    assert.equal(removed.connectionName, "Production DeepSeek");

    const [row] = await service.list();
    assert.equal(row.scope, "copilot");
    assert.equal(row.connectionId, null);
  });
});
