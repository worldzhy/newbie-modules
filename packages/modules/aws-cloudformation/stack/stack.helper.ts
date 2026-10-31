import type { Stack } from "@aws-sdk/client-cloudformation";

/** What the module reports about a stack: AWS facts only. */
export interface StackSnapshot {
  name: string;
  status: string;
  outputs: Record<string, string>;
  reason: string | null;
}

export class PollTimeoutError extends Error {}

export class PollRejectedError extends Error {}

/** Project a CloudFormation stack description into the module's own shape. */
export function toStackSnapshot(stack: Stack): StackSnapshot {
  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey) {
      outputs[output.OutputKey] = output.OutputValue ?? "";
    }
  }
  return {
    name: stack.StackName ?? "",
    status: stack.StackStatus ?? "UNKNOWN",
    outputs,
    reason: stack.StackStatusReason ?? null,
  };
}

export function isCreateSucceeded(status: string): boolean {
  return status === "CREATE_COMPLETE";
}

/** Terminal create failures, including a rollback (the stack is unusable). */
export function isCreateFailed(status: string): boolean {
  return status === "CREATE_FAILED" || status === "ROLLBACK_COMPLETE" || status === "ROLLBACK_FAILED";
}

export function isDeleteSucceeded(status: string): boolean {
  return status === "DELETE_COMPLETE";
}

export function isDeleteFailed(status: string): boolean {
  return status === "DELETE_FAILED";
}

/** True while AWS is still moving the stack towards a terminal state. */
export function isStackInProgress(status: string): boolean {
  return status === "CREATE_IN_PROGRESS" || status === "ROLLBACK_IN_PROGRESS" || status === "DELETE_IN_PROGRESS";
}

export function selectOutput(outputs: Record<string, string>, key: string): string | null {
  const value = outputs[key];
  return value && value.length > 0 ? value : null;
}

export interface PollUntilOptions<T> {
  intervalMs: number;
  timeoutMs: number;
  accept: (value: T) => boolean;
  /** Return a rejection message for a terminal failure, or null to keep polling. */
  fail?: (value: T) => string | null;
  describe: (value: T) => string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Read the external source of truth until it settles. Retries are bounded and
 * every wait has a deadline, so a stuck AWS call cannot hang a request forever.
 */
export async function pollUntil<T>(read: () => Promise<T>, options: PollUntilOptions<T>): Promise<T> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + options.timeoutMs;

  for (;;) {
    const value = await read();
    if (options.accept(value)) {
      return value;
    }
    const rejection = options.fail?.(value) ?? null;
    if (rejection) {
      throw new PollRejectedError(rejection);
    }
    if (now() >= deadline) {
      throw new PollTimeoutError(`Timed out after ${options.timeoutMs}ms waiting for ${options.describe(value)}.`);
    }
    await sleep(options.intervalMs);
  }
}
