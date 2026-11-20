import {
  isPenetrationTestingKey,
  findPlaybook,
  PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING,
  PENETRATION_TESTING_LEVEL_BY_KEY,
  type PenetrationTestingLevel,
} from "../penetration-testing.constants";
import type { PenetrationTestingAuthorizationRecord } from "../authorization/penetration-testing-authorization.service";
import type { PenetrationTestingTestObjectRecord } from "../authorization/penetration-testing-test-object.service";

export type PenetrationTestingGateReason =
  | "UNKNOWN_STANDARD_KEY"
  | "TARGET_NOT_ACTIVE"
  | "TARGET_NOT_VERIFIED"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_NOT_YET_VALID"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_FINDING_MISMATCH"
  | "AUTHORIZATION_ATTACK_CLASS_MISMATCH"
  | "L4_MAINTENANCE_WINDOW_MISSING"
  | "L4_OUTSIDE_MAINTENANCE_WINDOW"
  | "PLAYBOOK_UNKNOWN"
  | "TEST_OBJECT_MISSING"
  | "TEST_OBJECT_KIND_MISMATCH"
  | "ACTIVE_RUN_CONFLICT";

export interface PenetrationTestingGateInput {
  standardKey: string;
  /** Client-supplied intent only; never an authorization decision. */
  runConfig: Record<string, unknown>;
  target: { environment: string; verificationStatus: string; isActive: boolean };
  authorization: PenetrationTestingAuthorizationRecord | null;
  testObject: PenetrationTestingTestObjectRecord | null;
  /** Standard keys of the subject's QUEUED/RUNNING runs. */
  activeStandardKeys: string[];
  now: Date;
}

export type PenetrationTestingGateDecision =
  | {
      ok: true;
      level: PenetrationTestingLevel;
      authorization: PenetrationTestingAuthorizationRecord;
      testObject: PenetrationTestingTestObjectRecord | null;
      playbookId: string | null;
    }
  | { ok: false; reason: PenetrationTestingGateReason; detail?: string };

/**
 * The fail-closed gate (ADR-075 §4). Pure function: every input has already been
 * reloaded from the database by the run service, so a run config can never
 * assert its own authorization.
 *
 * Layer 1 (ownership) is represented by `target`: only an active, VERIFIED row
 * reaches this function. Layers 2 and 3 (written authorization and execution
 * snapshot) are checked here and in the host adapter respectively; the adapter
 * re-resolves the target and requires the snapshot to stay inside
 * `authorization.allowedCidrs`.
 *
 * L4 additionally requires: NON_PRODUCTION, an absolute maintenance window that
 * contains `now`, a known playbook, a matching approved disposable test object,
 * and no other active run on the same subject. L3 requires the authorization to
 * bind exactly the finding and attack class carried by the run config.
 */
export function evaluatePenetrationTestingGate(input: PenetrationTestingGateInput): PenetrationTestingGateDecision {
  if (!isPenetrationTestingKey(input.standardKey)) {
    return { ok: false, reason: "UNKNOWN_STANDARD_KEY", detail: input.standardKey };
  }
  const standardKey = input.standardKey;
  const level = PENETRATION_TESTING_LEVEL_BY_KEY[standardKey];

  if (!input.target.isActive) {
    return { ok: false, reason: "TARGET_NOT_ACTIVE" };
  }
  if (input.target.verificationStatus !== "VERIFIED") {
    return { ok: false, reason: "TARGET_NOT_VERIFIED", detail: input.target.verificationStatus };
  }

  const authorization = input.authorization;
  if (!authorization) {
    return { ok: false, reason: "AUTHORIZATION_MISSING" };
  }
  if (authorization.status !== "APPROVED") {
    return { ok: false, reason: "AUTHORIZATION_MISSING", detail: authorization.status };
  }
  if (input.now.getTime() < authorization.validFrom.getTime()) {
    return {
      ok: false,
      reason: "AUTHORIZATION_NOT_YET_VALID",
      detail: authorization.validFrom.toISOString(),
    };
  }
  if (input.now.getTime() > authorization.validUntil.getTime()) {
    return { ok: false, reason: "AUTHORIZATION_EXPIRED", detail: authorization.validUntil.toISOString() };
  }

  if (level !== "L4" && input.activeStandardKeys.includes(PENETRATION_TESTING_KEY_DESTRUCTIVE_TESTING)) {
    return {
      ok: false,
      reason: "ACTIVE_RUN_CONFLICT",
      detail: "a destructive-testing run is active on this subject",
    };
  }

  if (level === "L3") {
    const findingId = readString(input.runConfig, "findingId");
    const attackClass = readString(input.runConfig, "attackClass");
    if (!findingId || findingId !== authorization.findingId) {
      return { ok: false, reason: "AUTHORIZATION_FINDING_MISMATCH" };
    }
    if (!attackClass || attackClass !== authorization.attackClass) {
      return { ok: false, reason: "AUTHORIZATION_ATTACK_CLASS_MISMATCH" };
    }
  }

  if (level !== "L4") {
    return { ok: true, level, authorization, testObject: null, playbookId: null };
  }

  if (input.target.environment !== "NON_PRODUCTION") {
    return {
      ok: false,
      reason: "L4_OUTSIDE_MAINTENANCE_WINDOW",
      detail: `environment ${input.target.environment} is not NON_PRODUCTION`,
    };
  }
  const window = authorization.maintenanceWindow;
  if (!window) {
    return { ok: false, reason: "L4_MAINTENANCE_WINDOW_MISSING" };
  }
  if (!insideMaintenanceWindow(window, input.now)) {
    return { ok: false, reason: "L4_OUTSIDE_MAINTENANCE_WINDOW" };
  }
  if (input.activeStandardKeys.length > 0) {
    return {
      ok: false,
      reason: "ACTIVE_RUN_CONFLICT",
      detail: `active runs: ${input.activeStandardKeys.join(", ")}`,
    };
  }

  const playbookId = readString(input.runConfig, "playbookId");
  const playbook = findPlaybook(playbookId);
  if (!playbook) {
    return { ok: false, reason: "PLAYBOOK_UNKNOWN", detail: playbookId ?? undefined };
  }
  const testObjectId = readString(input.runConfig, "testObjectId");
  if (!testObjectId || !input.testObject) {
    return { ok: false, reason: "TEST_OBJECT_MISSING" };
  }
  if (input.testObject.kind !== playbook.testObjectKind) {
    return {
      ok: false,
      reason: "TEST_OBJECT_KIND_MISMATCH",
      detail: `playbook ${playbook.id} needs ${playbook.testObjectKind}, test object is ${input.testObject.kind}`,
    };
  }

  return { ok: true, level, authorization, testObject: input.testObject, playbookId: playbook.id };
}

/**
 * `start` and `end` are absolute ISO-8601 instants (with offset or `Z`); the
 * timezone label is informational. An action window is approved per action, so
 * it is stored as a concrete interval rather than a recurring rule.
 */
export function insideMaintenanceWindow(window: { start: string; end: string }, now: Date): boolean {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;
  const at = now.getTime();
  return at >= start && at <= end;
}

function readString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
