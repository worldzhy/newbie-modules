import { randomUUID } from "node:crypto";
import { COMPLETED_RUN_RETENTION_MS, CONVERSATION_TTL_MS } from "./agent-config";
import type { AgentEvent } from "./agent-events";
import type { ChatHistoryMessage } from "./agent-execution-context";

/**
 * Server-side conversation store (FR-21..FR-23, AC-7).
 *
 * v1 semantics (fixed for this implementation):
 * - Conversation state lives in memory with a 30-minute sliding TTL.
 * - A conversation runs at most one request at a time: a concurrent request
 *   fails with `run_in_progress` (HTTP 409 at the transport).
 * - A repeated `requestId` while the run is in flight also gets 409 with the
 *   existing run's requestId. After the run finishes, its complete event
 *   sequence is retained for 5 minutes and a repeated `requestId` is replayed
 *   without executing the model a second time.
 * - Conversations are bound to the user that created them; another user
 *   presenting the same id gets `conversation_forbidden`.
 *
 * The interface is the only seam the transport uses, so a persistent
 * implementation can replace the in-memory one later.
 */

export interface StoredConversationMessage extends ChatHistoryMessage {
  at: number;
}

export interface BeginRunCommand {
  userId: string;
  /** Absent for a brand-new conversation; the store assigns an id. */
  conversationId?: string;
  requestId: string;
  userMessage: string;
}

export interface RunHandle {
  readonly conversationId: string;
  /** Prior turns; the new user message is excluded and passed separately. */
  readonly history: ChatHistoryMessage[];
  /** Buffers events for idempotent replay; call as the runner emits them. */
  noteEvent(event: AgentEvent): void;
  /** Stores the final assistant answer, clears the run lock and retains replay. */
  succeed(assistantText: string): void;
  /** Clears the run lock and retains the (terminal-failure) replay. */
  fail(): void;
}

export type BeginRunOutcome =
  | { outcome: "started"; handle: RunHandle }
  | {
      outcome: "conflict";
      conversationId: string;
      existingRequestId: string;
      reason: "run_in_progress";
    }
  | { outcome: "replayed"; conversationId: string; events: AgentEvent[] }
  | { outcome: "forbidden"; reason: "conversation_owned_by_other_user" };

export interface ConversationStore {
  beginRun(command: BeginRunCommand): BeginRunOutcome;
}

/** DI token; the interface type is erased at runtime, so Nest needs a symbol. */
export const CONVERSATION_STORE = Symbol("ConversationStore");

interface ConversationRecord {
  conversationId: string;
  userId: string;
  messages: StoredConversationMessage[];
  createdAt: number;
  updatedAt: number;
  running: { requestId: string; startedAt: number } | null;
}

interface CompletedRunRecord {
  requestId: string;
  conversationId: string;
  userId: string;
  events: AgentEvent[];
  finishedAt: number;
}

export interface ConversationStoreClock {
  now(): number;
  uuid(): string;
}

const SYSTEM_CLOCK: ConversationStoreClock = {
  now: () => Date.now(),
  uuid: () => randomUUID(),
};

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly completedRuns = new Map<string, CompletedRunRecord>();
  private readonly ttlMs: number;
  private readonly retentionMs: number;
  private readonly clock: ConversationStoreClock;

  constructor(options: { ttlMs?: number; retentionMs?: number; clock?: ConversationStoreClock } = {}) {
    this.ttlMs = options.ttlMs ?? CONVERSATION_TTL_MS;
    this.retentionMs = options.retentionMs ?? COMPLETED_RUN_RETENTION_MS;
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  beginRun(command: BeginRunCommand): BeginRunOutcome {
    const now = this.clock.now();
    this.prune(now);

    const completed = this.completedRuns.get(command.requestId);
    if (completed) {
      if (completed.userId !== command.userId) {
        return { outcome: "forbidden", reason: "conversation_owned_by_other_user" };
      }
      return {
        outcome: "replayed",
        conversationId: completed.conversationId,
        events: completed.events,
      };
    }

    let record = command.conversationId ? this.conversations.get(command.conversationId) : undefined;

    if (record && record.userId !== command.userId) {
      return { outcome: "forbidden", reason: "conversation_owned_by_other_user" };
    }

    // Sliding expiry: an expired id restarts as a fresh conversation without
    // surfacing an error (AC-7 restart semantics).
    if (record && now - record.updatedAt > this.ttlMs) {
      record = undefined;
    }

    if (!record) {
      const conversationId = command.conversationId ?? this.clock.uuid();
      record = {
        conversationId,
        userId: command.userId,
        messages: [],
        createdAt: now,
        updatedAt: now,
        running: null,
      };
      this.conversations.set(conversationId, record);
    }

    if (record.running) {
      return {
        outcome: "conflict",
        conversationId: record.conversationId,
        existingRequestId: record.running.requestId,
        reason: "run_in_progress",
      };
    }

    const history: ChatHistoryMessage[] = record.messages.map(({ role, content }) => ({ role, content }));
    record.messages.push({ role: "user", content: command.userMessage, at: now });
    record.updatedAt = now;
    record.running = { requestId: command.requestId, startedAt: now };

    const owner = record;
    const events: AgentEvent[] = [];
    const handle: RunHandle = {
      conversationId: owner.conversationId,
      history,
      noteEvent: (event) => {
        events.push(event);
      },
      succeed: (assistantText) => {
        if (owner.running?.requestId !== command.requestId) return;
        owner.messages.push({ role: "assistant", content: assistantText, at: this.clock.now() });
        this.finish(owner, command, events);
      },
      fail: () => {
        if (owner.running?.requestId !== command.requestId) return;
        this.finish(owner, command, events);
      },
    };
    return { outcome: "started", handle };
  }

  private finish(record: ConversationRecord, command: BeginRunCommand, events: AgentEvent[]): void {
    const finishedAt = this.clock.now();
    record.running = null;
    record.updatedAt = finishedAt;
    this.completedRuns.set(command.requestId, {
      requestId: command.requestId,
      conversationId: record.conversationId,
      userId: command.userId,
      events,
      finishedAt,
    });
  }

  private prune(now: number): void {
    for (const [id, record] of this.conversations) {
      if (!record.running && now - record.updatedAt > this.ttlMs) {
        this.conversations.delete(id);
      }
    }
    for (const [requestId, run] of this.completedRuns) {
      if (now - run.finishedAt > this.retentionMs) {
        this.completedRuns.delete(requestId);
      }
    }
  }
}
