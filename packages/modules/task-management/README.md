# newbie.task-management

## Events

`TaskService.updateTask` emits `TASK_STATUS_CHANGED_EVENT` (`task-management.status-changed`) via `EventEmitter2` after a validated status transition. Same-status updates and non-status edits do not emit.

Payload (`TaskStatusChangedEvent`):

| Field            | Description                      |
| ---------------- | -------------------------------- |
| `taskId`         | Task id                          |
| `title`          | Task title after the update      |
| `spaceId`        | Owning task space id             |
| `previousStatus` | Status before the transition     |
| `status`         | Status after the transition      |
| `operatorName`   | Participant name of the operator |

The module does not know about projects or notification routing; hosts subscribe with `@OnEvent(TASK_STATUS_CHANGED_EVENT)` and resolve the space themselves.
