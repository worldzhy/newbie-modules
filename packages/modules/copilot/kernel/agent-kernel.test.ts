import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AgentRunner } from "./agent-runner";
import { SkillRegistry, type KernelLogger } from "./skill-registry";
import { InMemoryConfirmationManager } from "./confirmation-manager";
import { GENERAL_PAGE_ROUTE, type SkillDefinition } from "./skill";
import type { AgentExecutionContext } from "./agent-execution-context";
import type { AgentEvent } from "./agent-events";
import type { ChatMessage, ChatModelPort, ChatRequest, ModelFinishReason, ModelStreamChunk } from "./chat-model.port";

/**
 * Kernel verification (TR-3.1..TR-3.3): the agent tool loop is exercised with
 * a scripted stub model - multi-step tool round trip, step-limit circuit, and
 * structured invalid-argument feedback driving model self-correction.
 *
 * Run: `npm test` in the container.
 */

type TurnScript = (
  messages: ChatMessage[],
  turnIndex: number,
) => {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  finishReason?: ModelFinishReason;
};

class StubChatModel implements ChatModelPort {
  readonly modelId = "stub-model";
  public callCount = 0;
  public seenMessages: ChatMessage[] = [];

  constructor(private readonly script: TurnScript) {}

  async complete(request: ChatRequest) {
    const turn = this.script(request.messages, this.callCount);
    this.callCount += 1;
    this.seenMessages = request.messages;
    return {
      text: turn.text ?? "",
      toolCalls: turn.toolCalls ?? [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: turn.finishReason ?? (turn.toolCalls?.length ? "tool-calls" : "stop"),
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ModelStreamChunk> {
    const turn = this.script(request.messages, this.callCount);
    this.callCount += 1;
    this.seenMessages = request.messages;
    if (turn.text) {
      yield { type: "text-delta", text: turn.text };
    }
    for (const toolCall of turn.toolCalls ?? []) {
      yield { type: "tool-call", toolCall };
    }
    yield {
      type: "finish",
      finishReason: turn.finishReason ?? (turn.toolCalls?.length ? "tool-calls" : "stop"),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

function makeContext(signal: AbortSignal = AbortSignal.timeout(10_000)): AgentExecutionContext {
  return {
    userId: "user-1",
    conversationId: "conversation-1",
    requestId: "request-1",
    transport: "web",
    signal,
  };
}

async function collect(
  runner: AgentRunner,
  model: ChatModelPort,
  context: AgentExecutionContext = makeContext(),
  userMessage = "hello",
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runner.run({ model, context, userMessage, history: [] })) {
    events.push(event);
  }
  return events;
}

const echoSkill: SkillDefinition<{ value: string }> = {
  name: "echo_value",
  description: "Echoes a value for kernel testing.",
  inputSchema: z.object({ value: z.string().min(1) }),
  access: "read",
  confirmation: "never",
  transports: ["web"],
  pages: [GENERAL_PAGE_ROUTE],
  resultHint: { kind: "list", description: "one echoed value" },
  handler: (_context, input) => ({
    content: `echoed ${input.value}`,
    structured: { items: [{ value: input.value }] },
    actions: [{ type: "link", label: "Open", href: "/projects/echo" }],
  }),
};

const silentLogger: KernelLogger = { error: () => undefined };

describe("SkillRegistry registration", () => {
  it("accepts read-only never-confirm skills and exposes catalog metadata", () => {
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const catalog = registry.listFor("web");
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].name, "echo_value");
    assert.deepEqual((catalog[0].parameters as { type: string }).type, "object");
    assert.equal(registry.getRejectedRegistrations().length, 0);
  });

  it("TR-3.3: admits confirmation=always skills; the runner owns the approval gate", () => {
    const gated: SkillDefinition = {
      ...echoSkill,
      name: "gated_write",
      access: "write",
      confirmation: "always",
    };
    const registry = new SkillRegistry([gated, echoSkill], silentLogger);
    assert.equal(registry.has("gated_write"), true);
    assert.equal(registry.has("echo_value"), true);
    assert.equal(registry.requiresConfirmation("gated_write"), true);
    assert.equal(registry.requiresConfirmation("echo_value"), false);
    assert.equal(registry.getRejectedRegistrations().length, 0);
  });

  it("admits write-access skills for low-risk config operations", () => {
    const writeSkill: SkillDefinition = {
      ...echoSkill,
      name: "write_something",
      access: "write",
    };
    const registry = new SkillRegistry([writeSkill], silentLogger);
    assert.equal(registry.has("write_something"), true);
    assert.equal(registry.getRejectedRegistrations().length, 0);
  });

  it("TR-3.2: rejects input schemas declaring identity fields, including nested ones", () => {
    const identitySkill: SkillDefinition = {
      ...echoSkill,
      name: "identity_leak",
      inputSchema: z.object({ userId: z.string() }),
    };
    const nestedIdentitySkill: SkillDefinition = {
      ...echoSkill,
      name: "nested_identity_leak",
      inputSchema: z.object({ filter: z.object({ chatId: z.string() }) }),
    };
    const registry = new SkillRegistry([identitySkill, nestedIdentitySkill, echoSkill], silentLogger);
    assert.equal(registry.has("identity_leak"), false);
    assert.equal(registry.has("nested_identity_leak"), false);
    assert.equal(registry.has("echo_value"), true);
    const reasons = registry
      .getRejectedRegistrations()
      .map((r) => r.reason)
      .join("\n");
    assert.match(reasons, /userId/);
    assert.match(reasons, /chatId/);
  });

  it("rejects duplicate names and invalid names", () => {
    const registry = new SkillRegistry(
      [echoSkill, { ...echoSkill, description: "duplicate" }, { ...echoSkill, name: "Bad-Name" }],
      silentLogger,
    );
    assert.equal(registry.list().length, 1);
    assert.equal(registry.getRejectedRegistrations().length, 2);
  });

  it("filters skills by transport and page allow-list", () => {
    const pageSkill: SkillDefinition = {
      ...echoSkill,
      name: "page_specific",
      pages: ["/projects/[id]"],
    };
    const registry = new SkillRegistry([echoSkill, pageSkill], silentLogger);
    // No route means a General page: only General-declaring skills are offered.
    assert.deepEqual(
      registry.listFor("web").map((s) => s.name),
      ["echo_value"],
    );
    assert.deepEqual(
      registry
        .listFor("web", "/projects/[id]")
        .map((s) => s.name)
        .sort(),
      ["page_specific"],
    );
    assert.deepEqual(registry.listFor("web", "/elsewhere").map((s) => s.name), []);
  });
});

describe("AgentRunner tool loop", () => {
  it("TR-3.1: runs a multi-step tool round trip and emits the full event sequence", async () => {
    const model = new StubChatModel((messages, turnIndex) => {
      const lastToolResult = messages.at(-1);
      if (turnIndex === 0) {
        return {
          toolCalls: [{ id: "call-1", name: "echo_value", arguments: JSON.stringify({ value: "nightwatch" }) }],
        };
      }
      assert.equal(lastToolResult?.role, "tool");
      assert.equal((lastToolResult?.toolResult as { ok: boolean }).ok, true);
      return { text: "final answer" };
    });
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model);

    const types = events.map((e) => e.type);
    assert.deepEqual(types, ["run-started", "tool-started", "tool-finished", "action", "text-delta", "run-finished"]);
    assert.equal(model.callCount, 2);
    const finished = events.find((e) => e.type === "tool-finished");
    assert.equal(finished?.type === "tool-finished" && finished.status, "success");
    assert.match(finished?.type === "tool-finished" ? finished.summary : "", /list · 1 item/);
    const runFinished = events.find((e) => e.type === "run-finished");
    assert.equal(runFinished?.type === "run-finished" && runFinished.steps, 2);
  });

  it("TR-3.1: opens the step-limit circuit when the model keeps calling tools", async () => {
    const model = new StubChatModel(() => ({
      toolCalls: [{ id: "loop", name: "echo_value", arguments: JSON.stringify({ value: "x" }) }],
    }));
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model);

    // Ten model turns are allowed; tool batches from turns 1..9 execute and
    // the 10th unanswered tool batch trips the circuit instead of looping on.
    assert.equal(model.callCount, 10);
    assert.equal(events.filter((e) => e.type === "tool-started").length, 9);
    const failed = events.at(-1);
    assert.equal(failed?.type, "failed");
    assert.equal(failed?.type === "failed" && failed.code, "step_limit");
  });

  it("TR-3.1/AC-6: feeds structured validation errors back so the model self-corrects", async () => {
    const model = new StubChatModel((messages, turnIndex) => {
      if (turnIndex === 0) {
        return { toolCalls: [{ id: "bad", name: "echo_value", arguments: JSON.stringify({}) }] };
      }
      const feedback = messages.at(-1)?.toolResult as
        { ok: false; error: { code: string; issues?: Array<{ path: string }> } } | undefined;
      assert.equal(feedback?.ok, false);
      assert.equal(feedback?.error.code, "invalid_arguments");
      assert.ok(feedback?.error.issues?.some((issue) => issue.path === "value"));
      return { text: "self-corrected answer" };
    });
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model);

    const toolFinished = events.find((e) => e.type === "tool-finished");
    assert.equal(toolFinished?.type === "tool-finished" && toolFinished.status, "error");
    assert.equal(toolFinished?.type === "tool-finished" && toolFinished.summary, "error: invalid_arguments");
    assert.equal(events.at(-1)?.type, "run-finished");
  });

  it("turns malformed tool-call JSON into structured invalid_arguments feedback", async () => {
    const model = new StubChatModel((messages, turnIndex) => {
      if (turnIndex === 0) {
        return { toolCalls: [{ id: "broken", name: "echo_value", arguments: "not-json{" }] };
      }
      const feedback = messages.at(-1)?.toolResult as { ok: false; error: { code: string } } | undefined;
      assert.equal(feedback?.ok, false);
      assert.equal(feedback?.error.code, "invalid_arguments");
      return { text: "recovered" };
    });
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model);
    const toolFinished = events.find((e) => e.type === "tool-finished");
    assert.equal(toolFinished?.type === "tool-finished" && toolFinished.status, "error");
    assert.equal(events.at(-1)?.type, "run-finished");
  });

  it("emits an aborted failure when the caller signal is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = new StubChatModel(() => ({ text: "should not be produced" }));
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model, makeContext(controller.signal));
    assert.equal(model.callCount, 0);
    assert.equal(events[0]?.type, "run-started");
    assert.equal(events[1]?.type, "failed");
    assert.equal(events[1]?.type === "failed" && events[1].code, "aborted");
  });

  it("maps unknown tool names to structured errors instead of guessing", async () => {
    const model = new StubChatModel((_messages, turnIndex) => {
      if (turnIndex === 0) {
        return { toolCalls: [{ id: "x", name: "not_a_real_skill", arguments: "{}" }] };
      }
      return { text: "handled unknown tool" };
    });
    const registry = new SkillRegistry([echoSkill], silentLogger);
    const events = await collect(new AgentRunner(registry), model);
    const toolFinished = events.find((e) => e.type === "tool-finished");
    assert.equal(toolFinished?.type === "tool-finished" && toolFinished.status, "error");
    assert.equal(toolFinished?.type === "tool-finished" && toolFinished.summary, "error: unknown_skill");
    assert.equal(events.at(-1)?.type, "run-finished");
  });
});

/** Pulls events up to and including confirm-required, then leaves the run suspended. */
async function driveUntilConfirmation(
  runner: AgentRunner,
  model: ChatModelPort,
): Promise<{ events: AgentEvent[]; rest: AsyncIterator<AgentEvent> }> {
  const events: AgentEvent[] = [];
  const rest = runner.run({ model, context: makeContext(), userMessage: "do the write", history: [] })[
    Symbol.asyncIterator
  ]();
  for (let i = 0; i < 3; i += 1) {
    const current = await rest.next();
    assert.equal(current.done, false);
    events.push(current.value as AgentEvent);
  }
  assert.deepEqual(
    events.map((event) => event.type),
    ["run-started", "tool-started", "confirm-required"],
  );
  return { events, rest };
}

async function drainRest(rest: AsyncIterator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  while (true) {
    const current = await rest.next();
    if (current.done) return events;
    events.push(current.value as AgentEvent);
  }
}

function gatedSkill(onRun: () => void): SkillDefinition<{ name: string; apiKey?: string }> {
  return {
    name: "gated_write",
    description: "A write skill gated behind confirmation.",
    inputSchema: z.object({ name: z.string().min(1), apiKey: z.string().optional() }),
    access: "write",
    confirmation: "always",
    transports: ["web"],
    resultHint: { kind: "detail", description: "write result" },
    handler: (_context, input) => {
      onRun();
      return { content: `wrote ${input.name}`, structured: { name: input.name } };
    },
  };
}

describe("AgentRunner confirmation gate", () => {
  it("suspends a write, emits the validated args, and resumes after confirmed", async () => {
    let handlerRuns = 0;
    const manager = new InMemoryConfirmationManager(60_000);
    const registry = new SkillRegistry([gatedSkill(() => (handlerRuns += 1))], silentLogger);
    const runner = new AgentRunner(registry, undefined, manager);
    const model = new StubChatModel((_messages, turnIndex) => {
      if (turnIndex === 0) {
        return {
          toolCalls: [
            {
              id: "write-1",
              name: "gated_write",
              arguments: JSON.stringify({ name: "tile-a", apiKey: "sk-secret-123" }),
            },
          ],
        };
      }
      return { text: "done" };
    });

    const { events, rest } = await driveUntilConfirmation(runner, model);
    assert.equal(handlerRuns, 0, "handler must not run while the gate is pending");

    const required = events[2];
    assert.equal(required?.type, "confirm-required");
    if (required?.type !== "confirm-required") throw new Error("unreachable");
    assert.equal(required.toolCallId, "write-1");
    assert.equal(required.name, "gated_write");
    assert.deepEqual(required.arguments, { name: "tile-a", apiKey: "***redacted***" });
    assert.ok(required.confirmationId);

    const resolveResult = manager.resolve("user-1", required.confirmationId, "confirmed");
    assert.equal(resolveResult, "resolved");

    const restEvents = await drainRest(rest);
    assert.deepEqual(
      restEvents.map((event) => event.type),
      ["confirm-resolved", "tool-finished", "text-delta", "run-finished"],
    );
    assert.equal(handlerRuns, 1);
    const resolved = restEvents[0];
    assert.equal(resolved?.type, "confirm-resolved");
    if (resolved?.type !== "confirm-resolved") throw new Error("unreachable");
    assert.equal(resolved.decision, "confirmed");
    assert.equal(resolved.reason, "user");
    const finished = restEvents[1];
    assert.equal(finished?.type === "tool-finished" && finished.status, "success");
  });

  it("denies the write without running the handler and feeds a tool result back to the model", async () => {
    let handlerRuns = 0;
    const manager = new InMemoryConfirmationManager(60_000);
    const registry = new SkillRegistry([gatedSkill(() => (handlerRuns += 1))], silentLogger);
    const runner = new AgentRunner(registry, undefined, manager);
    let modelSawAfterDeny: ChatMessage | undefined;
    const model = new StubChatModel((messages, turnIndex) => {
      if (turnIndex === 0) {
        return {
          toolCalls: [{ id: "write-2", name: "gated_write", arguments: JSON.stringify({ name: "tile-b" }) }],
        };
      }
      modelSawAfterDeny = messages.at(-1);
      return { text: "cancelled, no changes made" };
    });

    const { events, rest } = await driveUntilConfirmation(runner, model);
    const required = events[2];
    if (required?.type !== "confirm-required") throw new Error("unreachable");
    manager.resolve("user-1", required.confirmationId, "denied");

    const restEvents = await drainRest(rest);
    assert.equal(handlerRuns, 0);
    const resolved = restEvents[0];
    assert.equal(resolved?.type === "confirm-resolved" && resolved.decision, "denied");
    const finished = restEvents[1];
    assert.equal(finished?.type === "tool-finished" && finished.status, "denied");
    assert.match(finished?.type === "tool-finished" ? finished.summary : "", /Declined by the user/);
    assert.deepEqual(modelSawAfterDeny?.role, "tool");
    const toolResult = modelSawAfterDeny?.toolResult as
      | { ok: boolean; result?: { structured?: unknown } }
      | undefined;
    assert.equal(toolResult?.ok, true);
    assert.deepEqual(toolResult?.result?.structured, { confirmation: "denied", reason: "user" });
  });

  it("auto-denies when nobody confirms within the wait window", async () => {
    let handlerRuns = 0;
    const manager = new InMemoryConfirmationManager(20);
    const registry = new SkillRegistry([gatedSkill(() => (handlerRuns += 1))], silentLogger);
    const runner = new AgentRunner(registry, undefined, manager);
    const model = new StubChatModel((_messages, turnIndex) =>
      turnIndex === 0
        ? { toolCalls: [{ id: "write-3", name: "gated_write", arguments: JSON.stringify({ name: "tile-c" }) }] }
        : { text: "timed out" },
    );

    const { rest } = await driveUntilConfirmation(runner, model);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const restEvents = await drainRest(rest);

    assert.equal(handlerRuns, 0);
    const resolved = restEvents[0];
    assert.equal(resolved?.type, "confirm-resolved");
    if (resolved?.type !== "confirm-resolved") throw new Error("unreachable");
    assert.equal(resolved.decision, "denied");
    assert.equal(resolved.reason, "timeout");
    assert.equal(restEvents[1]?.type === "tool-finished" && restEvents[1].status, "denied");
  });

  it("rejects resolutions from another user", async () => {
    const manager = new InMemoryConfirmationManager(60_000);
    const registry = new SkillRegistry([gatedSkill(() => {})], silentLogger);
    const runner = new AgentRunner(registry, undefined, manager);
    const model = new StubChatModel((_messages, turnIndex) =>
      turnIndex === 0
        ? { toolCalls: [{ id: "write-4", name: "gated_write", arguments: JSON.stringify({ name: "tile-d" }) }] }
        : { text: "unused" },
    );

    const { events } = await driveUntilConfirmation(runner, model);
    const required = events[2];
    if (required?.type !== "confirm-required") throw new Error("unreachable");
    assert.equal(manager.resolve("intruder", required.confirmationId, "confirmed"), "forbidden");
    assert.equal(manager.resolve("user-1", required.confirmationId, "confirmed"), "resolved");
  });
});
