import { randomUUID } from "node:crypto";
import { CONFIRMATION_TIMEOUT_MS } from "./agent-config";

/**
 * In-run human approval gate (session confirmation card flow).
 *
 * The runner suspends a tool call by requesting a pending confirmation and
 * awaiting `settled`; the web transport resolves the same pending entry from
 * a separate POST /copilot/chat/confirm request, so the original SSE stream
 * stays open and the run resumes in place. Timeout and run-abort settle the
 * gate as a denial so a suspended run can never hang forever.
 *
 * Like the conversation store, this is a framework-free in-memory seam; a
 * durable implementation can replace it later.
 */

export type ConfirmationDecision = "confirmed" | "denied";
export type ConfirmationReason = "user" | "timeout" | "aborted";

export interface ConfirmationOutcome {
  decision: ConfirmationDecision;
  reason: ConfirmationReason;
}

export interface ConfirmationRequestInput {
  userId: string;
  conversationId: string;
  requestId: string;
  toolCallId: string;
  toolName: string;
  /** Already validated and redacted arguments shown on the approval card. */
  arguments: unknown;
}

export interface PendingConfirmation extends ConfirmationRequestInput {
  confirmationId: string;
  createdAt: number;
  expiresAt: number;
}

export type ConfirmationResolveResult = "resolved" | "not_found" | "forbidden";

export interface ConfirmationManager {
  /**
   * Registers a pending confirmation tied to the run's abort signal and
   * resolves when the user decides, the timeout elapses, or the run aborts.
   */
  request(input: ConfirmationRequestInput, signal: AbortSignal): {
    confirmationId: string;
    pending: PendingConfirmation;
    settled: Promise<ConfirmationOutcome>;
  };
  /** Applies a user decision. Unknown/expired/already-settled ids fail closed. */
  resolve(userId: string, confirmationId: string, decision: ConfirmationDecision): ConfirmationResolveResult;
}

/** DI token; the interface type is erased at runtime, so Nest needs a symbol. */
export const CONFIRMATION_MANAGER = Symbol("ConfirmationManager");

interface PendingEntry {
  pending: PendingConfirmation;
  signal: AbortSignal;
  settle: (outcome: ConfirmationOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
  settled: boolean;
}

export class InMemoryConfirmationManager implements ConfirmationManager {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = CONFIRMATION_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  request(input: ConfirmationRequestInput, signal: AbortSignal): {
    confirmationId: string;
    pending: PendingConfirmation;
    settled: Promise<ConfirmationOutcome>;
  } {
    const confirmationId = randomUUID();
    const now = Date.now();
    const pending: PendingConfirmation = {
      ...input,
      confirmationId,
      createdAt: now,
      expiresAt: now + this.timeoutMs,
    };

    const settled = new Promise<ConfirmationOutcome>((resolve) => {
      const entry: PendingEntry = {
        pending,
        signal,
        settle: resolve,
        timer: setTimeout(() => {
          this.finalize(confirmationId, { decision: "denied", reason: "timeout" });
        }, this.timeoutMs),
        onAbort: () => {
          this.finalize(confirmationId, { decision: "denied", reason: "aborted" });
        },
        settled: false,
      };

      if (signal.aborted) {
        clearTimeout(entry.timer);
        resolve({ decision: "denied", reason: "aborted" });
        return;
      }

      signal.addEventListener("abort", entry.onAbort, { once: true });
      this.pending.set(confirmationId, entry);
    });

    return { confirmationId, pending, settled };
  }

  resolve(userId: string, confirmationId: string, decision: ConfirmationDecision): ConfirmationResolveResult {
    const entry = this.pending.get(confirmationId);
    if (!entry) return "not_found";
    if (entry.pending.userId !== userId) return "forbidden";
    this.finalize(confirmationId, { decision, reason: "user" });
    return "resolved";
  }

  private finalize(confirmationId: string, outcome: ConfirmationOutcome): void {
    const entry = this.pending.get(confirmationId);
    if (!entry || entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    entry.signal.removeEventListener("abort", entry.onAbort);
    this.pending.delete(confirmationId);
    entry.settle(outcome);
  }
}
