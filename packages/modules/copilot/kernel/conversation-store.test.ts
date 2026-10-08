import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConversationStore, InMemoryConversationStore, RunHandle } from "./conversation-store";
import { AgentEvent } from "./agent-events";

/**
 * Conversation store verification (TR-4.1..TR-4.3): conversation-level
 * serialization, requestId idempotency with replay, sliding TTL and user
 * ownership. A manual clock drives time without real sleeps.
 */

function makeClock() {
  let t = 1_000;
  let seq = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    uuid: () => `conv-${(seq += 1)}`,
  };
}

function vEvent(partial: Partial<AgentEvent> & { type: AgentEvent["type"] }): AgentEvent {
  return { v: 1, ...partial } as AgentEvent;
}

function firstHandle(outcome: ReturnType<ConversationStore["beginRun"]>): RunHandle {
  assert.equal(outcome.outcome, "started");
  return outcome.outcome === "started" ? outcome.handle : (undefined as never);
}

describe("InMemoryConversationStore", () => {
  it("TR-4.1: rejects a concurrent message on the same conversation with conflict", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });

    const first = store.beginRun({ userId: "u1", requestId: "r1", userMessage: "first" });
    assert.equal(first.outcome, "started");
    const conversationId = firstHandle(first).conversationId;

    const second = store.beginRun({
      userId: "u1",
      conversationId,
      requestId: "r2",
      userMessage: "second",
    });
    assert.deepEqual(second, {
      outcome: "conflict",
      conversationId,
      existingRequestId: "r1",
      reason: "run_in_progress",
    });
  });

  it("TR-4.2: replays the finished event sequence for a duplicate requestId without a new run", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    let modelExecutions = 0;

    const started = store.beginRun({ userId: "u1", requestId: "dup-1", userMessage: "hi" });
    modelExecutions += 1;
    const handle = firstHandle(started);
    const conversationId = handle.conversationId;
    handle.noteEvent(vEvent({ type: "run-started", requestId: "dup-1", conversationId, modelId: "m", skills: [] }));
    handle.noteEvent(vEvent({ type: "text-delta", text: "hello" }));
    handle.noteEvent(vEvent({ type: "run-finished", requestId: "dup-1", steps: 1, finishReason: "stop" }));
    handle.succeed("hello");

    // Duplicate submitted while the first run is long finished: replay, no execution.
    const duplicate = store.beginRun({ userId: "u1", conversationId, requestId: "dup-1", userMessage: "hi" });
    assert.equal(duplicate.outcome, "replayed");
    if (duplicate.outcome === "replayed") {
      assert.equal(duplicate.events.length, 3);
      assert.equal(duplicate.events[1].type, "text-delta");
    }
    assert.equal(modelExecutions, 1);

    // A genuinely new request after the finished run starts normally and sees history.
    const next = store.beginRun({ userId: "u1", conversationId, requestId: "r3", userMessage: "again" });
    assert.equal(next.outcome, "started");
    if (next.outcome === "started") {
      assert.equal(next.handle.history.length, 2);
      assert.deepEqual(next.handle.history[0], { role: "user", content: "hi" });
      assert.deepEqual(next.handle.history[1], { role: "assistant", content: "hello" });
    }
  });

  it("treats an in-flight duplicate requestId as a conflict with the existing run id", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    const first = store.beginRun({ userId: "u1", requestId: "same", userMessage: "hi" });
    const conversationId = firstHandle(first).conversationId;

    const duplicate = store.beginRun({
      userId: "u1",
      conversationId,
      requestId: "same",
      userMessage: "hi",
    });
    assert.equal(duplicate.outcome, "conflict");
    if (duplicate.outcome === "conflict") {
      assert.equal(duplicate.existingRequestId, "same");
    }
  });

  it("TR-4.3: an expired conversation restarts fresh with the same id and no error", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    const started = store.beginRun({ userId: "u1", requestId: "r1", userMessage: "old" });
    const handle = firstHandle(started);
    handle.succeed("old answer");

    clock.advance(31 * 60_000);
    const reopened = store.beginRun({
      userId: "u1",
      conversationId: handle.conversationId,
      requestId: "r2",
      userMessage: "new",
    });
    assert.equal(reopened.outcome, "started");
    if (reopened.outcome === "started") {
      assert.equal(reopened.handle.conversationId, handle.conversationId);
      assert.equal(reopened.handle.history.length, 0);
    }
  });

  it("TR-4.3: forbids access to another user's conversation and retained replay", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    const started = store.beginRun({ userId: "owner", requestId: "secret", userMessage: "hi" });
    const handle = firstHandle(started);
    handle.succeed("private answer");

    assert.equal(
      store.beginRun({
        userId: "intruder",
        conversationId: handle.conversationId,
        requestId: "rx",
        userMessage: "hi",
      }).outcome,
      "forbidden",
    );
    assert.equal(
      store.beginRun({
        userId: "intruder",
        conversationId: handle.conversationId,
        requestId: "secret",
        userMessage: "hi",
      }).outcome,
      "forbidden",
    );
  });

  it("releases the run lock after fail() and keeps the failure replay", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    const started = store.beginRun({ userId: "u1", requestId: "r-fail", userMessage: "hi" });
    const handle = firstHandle(started);
    handle.noteEvent(vEvent({ type: "failed", requestId: "r-fail", code: "model_upstream", message: "boom" }));
    handle.fail();

    const retry = store.beginRun({
      userId: "u1",
      conversationId: handle.conversationId,
      requestId: "r-next",
      userMessage: "retry",
    });
    assert.equal(retry.outcome, "started");

    const duplicate = store.beginRun({
      userId: "u1",
      conversationId: handle.conversationId,
      requestId: "r-fail",
      userMessage: "hi",
    });
    assert.equal(duplicate.outcome, "replayed");
    if (duplicate.outcome === "replayed") {
      assert.equal(duplicate.events[0].type, "failed");
    }
  });

  it("drops retained replays after the 5 minute idempotency window", () => {
    const clock = makeClock();
    const store = new InMemoryConversationStore({ clock });
    const started = store.beginRun({ userId: "u1", requestId: "old", userMessage: "hi" });
    const handle = firstHandle(started);
    handle.succeed("answer");

    clock.advance(5 * 60_000 + 1);
    const again = store.beginRun({
      userId: "u1",
      conversationId: handle.conversationId,
      requestId: "old",
      userMessage: "hi",
    });
    assert.equal(again.outcome, "started");
  });
});
