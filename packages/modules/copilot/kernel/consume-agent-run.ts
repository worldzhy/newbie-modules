import type { AgentEvent } from "./agent-events";
import type { RunHandle } from "./conversation-store";

/**
 * Transport-neutral consumption of one agent run. Drains the event stream,
 * buffers every event for replay via the run handle, accumulates the
 * assistant text, and settles the handle on the terminal event
 * (run-finished/failed). Transports observe frames through onEvent (write an
 * SSE frame, send a confirmation card, ...) without re-implementing the
 * accumulation and terminal-state bookkeeping.
 *
 * Returns the accumulated assistant text. If the generator dies without a
 * terminal event, the handle is failed here so the conversation lock is not
 * stuck until TTL expiry; fail() is a no-op once the handle has settled.
 */
export async function consumeAgentRun(
  handle: RunHandle,
  stream: AsyncIterable<AgentEvent>,
  onEvent?: (event: AgentEvent) => void | Promise<void>,
): Promise<string> {
  let assistantText = "";
  let terminalSeen = false;
  try {
    for await (const event of stream) {
      if (event.type === "text-delta") assistantText += event.text;
      handle.noteEvent(event);
      await onEvent?.(event);
      if (event.type === "run-finished") {
        terminalSeen = true;
        handle.succeed(assistantText);
      } else if (event.type === "failed") {
        terminalSeen = true;
        handle.fail();
      }
    }
  } finally {
    // Release the conversation lock even when the stream or an observer
    // throws before a terminal event settles the handle.
    if (!terminalSeen) handle.fail();
  }
  return assistantText;
}
