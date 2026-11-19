import { TaskStatus } from "@generated/prisma/enums";
import { defineEvent } from "@modules/event-emitter/event-definition";

/**
 * Emitted after a task's status actually transitions (a validated move between
 * two distinct states). Same-status updates and non-status edits do not emit.
 * The module deliberately knows nothing about projects or notifications — the
 * host application resolves the space and routes alerts.
 */
export const TASK_STATUS_CHANGED_EVENT = "task-management.status-changed";

export interface TaskStatusChangedEvent {
  taskId: string;
  title: string;
  spaceId: string;
  previousStatus: TaskStatus;
  status: TaskStatus;
  operatorName?: string;
}

const TASK_STATUS_CHANGED = defineEvent<TaskStatusChangedEvent>({
  key: TASK_STATUS_CHANGED_EVENT,
  name: "Task status changed",
  description:
    "Emitted after a task's status actually transitions (a validated move between two distinct states). Same-status updates and non-status edits do not emit.",
  payloadExample: {
    taskId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    title: "Ship the milestone",
    spaceId: "ckv1a2b3c4d5e6f7g8h9i0j2",
    previousStatus: "PENDING",
    status: "DEVELOPING",
    operatorName: "worldzhy",
  },
});

/**
 * Emitted after a frozen delivery plan (impact / scopePaths / changeClass) is
 * edited through the human override channel (ADR-054 D3). The module records
 * the fact; the host writes the audit row, exactly as it does for status
 * changes.
 */
export const TASK_PLAN_OVERRIDE_EVENT = "task-management.plan-override";

export interface TaskPlanOverrideEvent {
  taskId: string;
  spaceId: string;
  /** Plan fields the override changed. */
  fields: string[];
  reason: string;
  operatorParticipantId?: string;
  operatorName?: string;
  /** Freeze timestamp the override is applied on, ISO 8601. */
  frozenAt: string;
}

const TASK_PLAN_OVERRIDE = defineEvent<TaskPlanOverrideEvent>({
  key: TASK_PLAN_OVERRIDE_EVENT,
  name: "Task plan overridden",
  description:
    "Emitted after a frozen delivery plan (impact / scopePaths / changeClass) is edited through the human override channel (ADR-054 D3).",
  payloadExample: {
    taskId: "ckv1a2b3c4d5e6f7g8h9i0j1",
    spaceId: "ckv1a2b3c4d5e6f7g8h9i0j2",
    fields: ["scopePaths"],
    reason: "Accepted an extra module after the design review",
    operatorParticipantId: "ckv1a2b3c4d5e6f7g8h9i0j3",
    operatorName: "worldzhy",
    frozenAt: "2026-11-19T08:59:38.000Z",
  },
});

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const taskManagementEventDeclarations = [TASK_STATUS_CHANGED, TASK_PLAN_OVERRIDE];
