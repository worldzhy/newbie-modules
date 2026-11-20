import type {
  PenetrationTestingDestructiveActionRequest,
  PenetrationTestingDestructiveActionResult,
} from "./penetration-testing.contracts";

/**
 * PenetrationDestructiveActionAccess — the host-provided executor of one L4
 * playbook against one approved test object (ADR-075 §5).
 *
 * One call performs exactly one action: it records the state before, applies
 * the fixed playbook, records the state after, cleans up, and verifies the
 * cleanup. The module never batches actions, and a cleanup failure is a
 * terminal `CLEANUP_FAILED` outcome, not a warning.
 */
export const PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS = "PENETRATION_TESTING_DESTRUCTIVE_ACTION_ACCESS";

export interface PenetrationDestructiveActionAccess {
  execute(request: PenetrationTestingDestructiveActionRequest): Promise<PenetrationTestingDestructiveActionResult>;
}
