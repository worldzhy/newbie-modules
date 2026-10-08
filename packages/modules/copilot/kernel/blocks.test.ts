import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { AgentRunner } from "./agent-runner";
import { SkillRegistry, type KernelLogger } from "./skill-registry";
import type { AgentEvent, CopilotSkillBlock } from "./agent-events";
import type { AgentExecutionContext } from "./agent-execution-context";
import type { SkillDefinition } from "./skill";
import type { ChatModelPort, ChatRequest, ModelFinishReason, ModelStreamChunk } from "./chat-model.port";
import { boundBlocks, summarizeBlocks, BLOCKS_SERIALIZED_CAP_BYTES, CHART_POINT_CAP, TABLE_ROW_CAP } from "./blocks";

/**
 * TR-3.1/TR-3.2 for the phase-2 blocks protocol extension (FR-7): old skills
 * see no protocol change; oversized blocks are bounded and marked truncated.
 *
 * Run: `npm test` in the container.
 */

const silentLogger: KernelLogger = { error: () => undefined };

function makeContext(): AgentExecutionContext {
  return {
    userId: "user-1",
    conversationId: "conversation-1",
    requestId: "request-1",
    transport: "web",
    signal: AbortSignal.timeout(10_000),
  };
}

function scriptedModel(toolCalls: Array<{ id: string; name: string; arguments: string }>): ChatModelPort {
  let calls = 0;
  return {
    modelId: "stub-model",
    complete: async (_request: ChatRequest) => ({
      text: "",
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop" as ModelFinishReason,
    }),
    stream: async function* (_request: ChatRequest): AsyncIterable<ModelStreamChunk> {
      calls += 1;
      if (calls > 1) {
        yield { type: "text-delta", text: "done" };
        yield {
          type: "finish",
          finishReason: "stop" as ModelFinishReason,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
        return;
      }
      for (const toolCall of toolCalls) yield { type: "tool-call", toolCall };
      yield {
        type: "finish",
        finishReason: "tool-calls" as ModelFinishReason,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    },
  };
}

async function collect(runner: AgentRunner, model: ChatModelPort): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runner.run({ model, context: makeContext(), userMessage: "hi", history: [] })) {
    events.push(event);
  }
  return events;
}

const plainSkill: SkillDefinition<{ value: string }> = {
  name: "plain_echo",
  description: "Echo without blocks.",
  inputSchema: z.object({ value: z.string().min(1) }),
  access: "read",
  confirmation: "never",
  transports: ["web"],
  resultHint: { kind: "detail", description: "echo" },
  handler: (_ctx, input) => ({ content: `echoed ${input.value}`, structured: { value: input.value } }),
};

test("TR-3.1: a skill without producesBlocks sees an unchanged tool-finished event", async () => {
  const registry = new SkillRegistry([plainSkill], silentLogger);
  const runner = new AgentRunner(registry);
  const events = await collect(runner, scriptedModel([{ id: "c1", name: "plain_echo", arguments: '{"value":"x"}' }]));

  const finished = events.find((event) => event.type === "tool-finished");
  assert.ok(finished);
  if (finished?.type === "tool-finished") {
    assert.equal(finished.status, "success");
    assert.equal("blocks" in finished, false);
  }
});

test("TR-3.1: blocks returned by a non-opted-in skill are never forwarded", async () => {
  const sneaky: SkillDefinition = {
    ...plainSkill,
    name: "sneaky_blocks",
    handler: () => ({
      content: "hi",
      blocks: [{ kind: "query", templateId: "t", title: "t", sql: "SELECT 1" }],
    }),
  };
  const registry = new SkillRegistry([sneaky], silentLogger);
  const runner = new AgentRunner(registry);
  const events = await collect(runner, scriptedModel([{ id: "c1", name: "sneaky_blocks", arguments: '{"value":"x"}' }]));
  const finished = events.find((event) => event.type === "tool-finished");
  if (finished?.type === "tool-finished") assert.equal("blocks" in finished, false);
});

test("TR-3.1: an opted-in skill forwards bounded blocks on tool-finished", async () => {
  const blocky: SkillDefinition = {
    ...plainSkill,
    name: "blocky",
    producesBlocks: true,
    handler: () => ({
      content: "hi",
      blocks: [
        { kind: "chart", chartType: "line", title: "t", labels: ["a", "b"], datasets: [{ label: "d", data: [1, 2] }] },
        { kind: "query", templateId: "t", title: "t", sql: "SELECT 1" },
      ],
    }),
  };
  const registry = new SkillRegistry([blocky], silentLogger);
  const runner = new AgentRunner(registry);
  const events = await collect(runner, scriptedModel([{ id: "c1", name: "blocky", arguments: '{"value":"x"}' }]));
  const finished = events.find((event) => event.type === "tool-finished");
  assert.ok(finished);
  if (finished?.type === "tool-finished") {
    assert.equal(finished.blocks?.length, 2);
    assert.equal(finished.blocks?.[0].kind, "chart");
  }
});

test("TR-3.2: chart points and table rows are capped and marked truncated", () => {
  const chart: CopilotSkillBlock = {
    kind: "chart",
    chartType: "line",
    title: "big",
    labels: Array.from({ length: CHART_POINT_CAP + 50 }, (_, index) => `p${index}`),
    datasets: [{ label: "d", data: Array.from({ length: CHART_POINT_CAP + 50 }, (_, index) => index) }],
  };
  const table: CopilotSkillBlock = {
    kind: "table",
    title: "big",
    columns: [{ field: "a", header: "A" }],
    rows: Array.from({ length: TABLE_ROW_CAP + 25 }, (_, index) => ({ a: index })),
    totalRows: TABLE_ROW_CAP + 25,
  };

  const bounded = boundBlocks([chart, table]);
  const boundedChart = bounded[0];
  assert.equal(boundedChart.kind, "chart");
  if (boundedChart.kind === "chart") {
    assert.equal(boundedChart.labels.length, CHART_POINT_CAP);
    assert.equal(boundedChart.datasets[0].data.length, CHART_POINT_CAP);
    assert.equal(boundedChart.truncated, true);
  }
  const boundedTable = bounded[1];
  assert.equal(boundedTable.kind, "table");
  if (boundedTable.kind === "table") {
    assert.equal(boundedTable.rows.length, TABLE_ROW_CAP);
    assert.equal(boundedTable.totalRows, TABLE_ROW_CAP + 25);
    assert.equal(boundedTable.truncated, true);
  }
});

test("TR-3.2: the serialized block array never exceeds the byte budget", () => {
  const big = "x".repeat(BLOCKS_SERIALIZED_CAP_BYTES); // ~64KB per block
  const blocks: CopilotSkillBlock[] = [
    { kind: "table", title: big, columns: [{ field: "a", header: big }], rows: [{ a: big }], totalRows: 1 },
    { kind: "query", templateId: "t", title: "t", sql: "SELECT 1" },
  ];
  const bounded = boundBlocks(blocks);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= BLOCKS_SERIALIZED_CAP_BYTES);
  assert.equal(bounded.length, 1);
  assert.equal(bounded[0].truncated, true);
});

test("summarizeBlocks records template id and counts, never payloads", () => {
  const summary = summarizeBlocks([
    { kind: "chart", chartType: "bar", title: "s3cr3t-title", labels: ["a"], datasets: [{ label: "d", data: [1] }] },
    { kind: "table", title: "t", columns: [], rows: [{ a: 1 }, { a: 2 }], totalRows: 2 },
    { kind: "query", templateId: "recent_requests", title: "t", sql: "SELECT password FROM x" },
  ]);
  assert.match(summary, /3 block\(s\)/);
  assert.match(summary, /template=recent_requests/);
  assert.match(summary, /chart:bar\(1pt\)/);
  assert.match(summary, /table\(2\/2 rows\)/);
  assert.ok(!summary.includes("password"));
  assert.ok(!summary.includes("s3cr3t-title"));
});
