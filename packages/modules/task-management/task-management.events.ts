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

/// The module's full event contract, activated by the host's
/// event-declarations wiring (ADR-028). Never self-registered here.
export const taskManagementEventDeclarations = [TASK_STATUS_CHANGED];
