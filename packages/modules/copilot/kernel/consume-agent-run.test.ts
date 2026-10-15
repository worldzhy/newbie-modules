import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AGENT_EVENT_PROTOCOL_VERSION, type AgentEvent } from "./agent-events";
import { consumeAgentRun } from "./consume-agent-run";
import type { RunHandle } from "./conversation-store";

function textDelta(text: string): AgentEvent {
  return { v: AGENT_EVENT_PROTOCOL_VERSION, type: "text-delta", text };
}

function runFinished(): AgentEvent {
  return { v: AGENT_EVENT_PROTOCOL_VERSION, type: "run-finished", requestId: "r1", steps: 1, finishReason: "stop" };
}

function failed(): AgentEvent {
  return { v: AGENT_EVENT_PROTOCOL_VERSION, type: "failed", requestId: "r1", code: "internal", message: "boom" };
}

async function* streamOf(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const event of events) yield event;
}

interface RecordedHandle extends RunHandle {
  calls: string[];
}

function makeHandle(): RecordedHandle {
  const calls: string[] = [];
  return {
    calls,
    conversationId: "c1",
    history: [],
    noteEvent: (event) => calls.push(`note:${event.type}`),
    succeed: (text) => calls.push(`succeed:${text}`),
    fail: () => calls.push("fail"),
  };
}

describe("consumeAgentRun", () => {
  it("accumulates text-delta, buffers every event, and succeeds on run-finished", async () => {
    const handle = makeHandle();
    const text = await consumeAgentRun(handle, streamOf([textDelta("he"), textDelta("llo"), runFinished()]));
    assert.equal(text, "hello");
    assert.deepEqual(handle.calls, ["note:text-delta", "note:text-delta", "note:run-finished", "succeed:hello"]);
  });

  it("fails the handle on a failed event and never succeeds", async () => {
    const handle = makeHandle();
    const text = await consumeAgentRun(handle, streamOf([textDelta("partial"), failed()]));
    assert.equal(text, "partial");
    assert.deepEqual(handle.calls, ["note:text-delta", "note:failed", "fail"]);
  });

  it("fails the handle when the stream ends without a terminal event", async () => {
    const handle = makeHandle();
    await consumeAgentRun(handle, streamOf([textDelta("orphan")]));
    assert.deepEqual(handle.calls, ["note:text-delta", "fail"]);
  });

  it("invokes onEvent for every frame in order, after noteEvent and before terminal settling", async () => {
    const handle = makeHandle();
    const seen: string[] = [];
    await consumeAgentRun(handle, streamOf([textDelta("x"), runFinished()]), (event) => {
      seen.push(`${event.type}@${handle.calls.length}`);
    });
    assert.deepEqual(seen, ["text-delta@1", "run-finished@2"]);
  });

  it("awaits an async onEvent before moving to the next frame", async () => {
    const handle = makeHandle();
    const order: string[] = [];
    await consumeAgentRun(handle, streamOf([textDelta("a"), textDelta("b"), runFinished()]), async (event) => {
      order.push(`enter:${event.type}`);
      await new Promise((resolve) => setImmediate(resolve));
      order.push(`exit:${event.type}`);
    });
    assert.deepEqual(order, [
      "enter:text-delta",
      "exit:text-delta",
      "enter:text-delta",
      "exit:text-delta",
      "enter:run-finished",
      "exit:run-finished",
    ]);
  });

  it("works without an onEvent observer", async () => {
    const handle = makeHandle();
    const text = await consumeAgentRun(handle, streamOf([runFinished()]));
    assert.equal(text, "");
    assert.deepEqual(handle.calls, ["note:run-finished", "succeed:"]);
  });
});
