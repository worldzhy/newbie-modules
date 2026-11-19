# newbie.task-management

## Delivery-plan fields

Tasks carry the delivery-plan fields from ADR-054 D2 so every host that runs the
delivery pipeline shares the same vocabulary:

| Field                    | Meaning                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `parentId`               | Parent task; a task with a parent is a design unit, not started                |
| `designRef`              | Design source reference (ADR / spec id or path)                                |
| `acceptanceCriteria`     | Acceptance criteria, required before a task may start                          |
| `scopePaths`             | Allowed path globs; also the measurement for `changeClass`                     |
| `impact`                 | Declared impact (`repos`, `touchesSchema`, `touchesContracts`, `irreversible`) |
| `changeClass`            | Derived `SIMPLE` / `DESIGNED`; never supplied by callers                       |
| `dependsOn`              | Prerequisite task ids that must reach `COMPLETED` first                        |
| `sourceRef`              | Origin discussion reference (`chatId`, `messageId`)                            |
| `blockedReason`          | Required when a task moves to `BLOCKED`                                        |
| `designRefJustification` | Why the change falls inside the `designRef` scope                              |
| `requirementReview`      | Requirement-review summary from the discussion stage                           |

`changeClass` is computed by `deriveChangeClass(impact, scopePaths)`: `DESIGNED`
when the task spans several repositories, touches the schema or a contract, is
irreversible, or declares more than 20 allowed path globs; `SIMPLE` otherwise.

## Status transitions

`BLOCKED` means a gate stopped the task and a human must clear it:

- `PENDING → DEVELOPING | BLOCKED | CANCELLED`
- `DEVELOPING → TESTING | BLOCKED | CANCELLED`
- `TESTING → DEVELOPING | DEPLOYED | COMPLETED | CANCELLED`
- `DEPLOYED → DEVELOPING | COMPLETED | CANCELLED`
- `BLOCKED → DEVELOPING | CANCELLED`
- `COMPLETED` and `CANCELLED` are terminal.

A transition into `BLOCKED` is rejected unless `blockedReason` is supplied.

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
