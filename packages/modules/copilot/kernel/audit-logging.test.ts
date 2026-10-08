import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AgentRunner } from "./agent-runner";
import { SkillRegistry } from "./skill-registry";
import { InMemoryConfirmationManager } from "./confirmation-manager";
import type { SkillDefinition } from "./skill";
import type { AgentExecutionContext } from "./agent-execution-context";
import type { CopilotAuditEntry, CopilotAuditSink } from "./audit-sink";
import type { ChatModelPort, ChatRequest, ModelStreamChunk } from "./chat-model.port";
import { ModelCallError } from "./chat-model.port";

/**
 * Audit verification (TR-5.1): one multi-tool run emits complete model_call
 * and skill_call entries, and secret-looking arguments never reach the log
 * stream in plaintext.
 */

const SECRET_KEY = "sk-plaintext-secret-987654321";

class CollectingAuditSink implements CopilotAuditSink {
  public readonly entries: CopilotAuditEntry[] = [];
  record(entry: CopilotAuditEntry): void {
    this.entries.push(entry);
  }
}

const secretEchoSkill: SkillDefinition<{ value: string; apiKey?: string }> = {
  name: "secret_echo",
  description: "Accepts an inadvertently passed secret for redaction testing.",
  inputSchema: z.object({ value: z.string(), apiKey: z.string().optional() }),
  access: "read",
  confirmation: "never",
  transports: ["web"],
  resultHint: { kind: "detail", description: "echo" },
  handler: (_context, input) => ({ content: input.value, structured: { value: input.value } }),
};

class ScriptedModel implements ChatModelPort {
  readonly modelId = "audit-stub-model";
  constructor(
    private readonly turn: (
      turnIndex: number,
    ) => { text: string } | { toolCall: { name: string; args: Record<string, unknown> } },
  ) {}
  async complete(): Promise<never> {
    throw new Error("not used");
  }
  async *stream(_request: ChatRequest): AsyncIterable<ModelStreamChunk> {
    const step = (this as unknown as { calls?: number }).calls ?? 0;
    (this as unknown as { calls?: number }).calls = step + 1;
    const outcome = this.turn(step);
    if ("text" in outcome) {
      yield { type: "text-delta", text: outcome.text };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      };
      return;
    }
    yield {
      type: "tool-call",
      toolCall: {
        id: `call-${step}`,
        name: outcome.toolCall.name,
        arguments: JSON.stringify(outcome.toolCall.args),
      },
    };
    yield {
      type: "finish",
      finishReason: "tool-calls",
      usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
    };
  }
}

async function drain(model: ChatModelPort, runner: AgentRunner, context: AgentExecutionContext) {
  for await (const _event of runner.run({ model, context, userMessage: "run", history: [] })) {
    // consume
  }
}

function makeContext(): AgentExecutionContext {
  return {
    userId: "user-audit",
    conversationId: "conversation-audit",
    requestId: "request-audit",
    transport: "web",
    signal: AbortSignal.timeout(10_000),
  };
}

describe("Copilot audit logging", () => {
  it("TR-5.1: emits complete model_call and skill_call entries and redacts secrets", async () => {
    const sink = new CollectingAuditSink();
    const registry = new SkillRegistry([secretEchoSkill], undefined, sink);
    const runner = new AgentRunner(registry, sink);
    const model = new ScriptedModel((turnIndex) =>
      turnIndex === 0
        ? { toolCall: { name: "secret_echo", args: { value: "ok", apiKey: SECRET_KEY } } }
        : { text: "done" },
    );

    await drain(model, runner, makeContext());

    const modelEntries = sink.entries.filter((e) => e.category === "copilot.model_call");
    const skillEntries = sink.entries.filter((e) => e.category === "copilot.skill_call");
    assert.equal(modelEntries.length, 2);
    assert.equal(skillEntries.length, 1);

    for (const entry of modelEntries) {
      assert.equal(entry.category, "copilot.model_call");
      if (entry.category !== "copilot.model_call") return;
      assert.equal(entry.requestId, "request-audit");
      assert.equal(entry.conversationId, "conversation-audit");
      assert.equal(entry.userId, "user-audit");
      assert.equal(entry.model, "audit-stub-model");
      assert.equal(entry.success, true);
      assert.equal(entry.promptTokens, 11);
      assert.equal(entry.completionTokens, 7);
      assert.equal(typeof entry.latencyMs, "number");
    }

    const skillEntry = skillEntries[0];
    assert.equal(skillEntry?.category, "copilot.skill_call");
    if (skillEntry?.category === "copilot.skill_call") {
      assert.equal(skillEntry.skillName, "secret_echo");
      assert.equal(skillEntry.status, "success");
      assert.equal(typeof skillEntry.durationMs, "number");
      assert.match(skillEntry.argumentSummary, /\*\*\*redacted\*\*\*/);
      assert.ok(!skillEntry.argumentSummary.includes(SECRET_KEY));
    }

    const serialized = JSON.stringify(sink.entries);
    assert.ok(!serialized.includes(SECRET_KEY), "plaintext apiKey leaked into audit payload");
  });

  it("audits the confirmation lifecycle for a gated write that gets confirmed", async () => {
    const sink = new CollectingAuditSink();
    const gatedWriteSkill: SkillDefinition<{ name: string }> = {
      name: "gated_audit_write",
      description: "Gated write for confirmation audit testing.",
      inputSchema: z.object({ name: z.string() }),
      access: "write",
      confirmation: "always",
      transports: ["web"],
      resultHint: { kind: "detail", description: "write" },
      handler: () => ({ content: "written", structured: { ok: true } }),
    };
    const manager = new InMemoryConfirmationManager(60_000);
    const registry = new SkillRegistry([gatedWriteSkill], undefined, sink);
    const runner = new AgentRunner(registry, sink, manager);
    const model = new ScriptedModel((turnIndex) =>
      turnIndex === 0
        ? { toolCall: { name: "gated_audit_write", args: { name: "tile" } } }
        : { text: "confirmed and written" },
    );

    const iterator = runner.run({ model, context: makeContext(), userMessage: "run", history: [] })[
      Symbol.asyncIterator
    ]();
    for (let i = 0; i < 3; i += 1) await iterator.next();
    // Third event is confirm-required; read it back from the audit trail.
    const required = sink.entries.find((entry) => entry.category === "copilot.confirmation" && entry.phase === "required");
    assert.ok(required);
    if (!required || required.category !== "copilot.confirmation") throw new Error("unreachable");
    assert.equal(required.skillName, "gated_audit_write");
    manager.resolve("user-audit", required.confirmationId, "confirmed");
    while (true) {
      const current = await iterator.next();
      if (current.done) break;
    }

    const confirmationEntries = sink.entries.filter((entry) => entry.category === "copilot.confirmation");
    assert.equal(confirmationEntries.length, 2);
    const resolved = confirmationEntries[1];
    assert.equal(resolved?.category, "copilot.confirmation");
    if (resolved?.category !== "copilot.confirmation") throw new Error("unreachable");
    assert.equal(resolved.phase, "resolved");
    assert.equal(resolved.decision, "confirmed");
    assert.equal(resolved.reason, "user");

    // The handler still produced its normal skill_call audit once confirmed.
    const skillEntries = sink.entries.filter((entry) => entry.category === "copilot.skill_call");
    assert.equal(skillEntries.length, 1);
    assert.equal(skillEntries[0] && "status" in skillEntries[0] ? skillEntries[0].status : "", "success");
  });

  it("records failed model calls with normalized error category", async () => {
    const sink = new CollectingAuditSink();
    const registry = new SkillRegistry([], undefined, sink);
    const runner = new AgentRunner(registry, sink);
    const failingModel: ChatModelPort = {
      modelId: "broken-model",
      async complete(): Promise<never> {
        throw new Error("not used");
      },
      async *stream(): AsyncIterable<ModelStreamChunk> {
        throw new ModelCallError("auth", "rejected", 401);
      },
    };

    await drain(failingModel, runner, makeContext());

    const entry = sink.entries[0];
    assert.equal(entry?.category, "copilot.model_call");
    if (entry?.category === "copilot.model_call") {
      assert.equal(entry.success, false);
      assert.equal(entry.errorCategory, "auth");
    }
  });
});
