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
| `planFrozenAt`           | When the plan froze; null until the task first starts                          |

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

## Gate 1: start admission

`PENDING → DEVELOPING` and `BLOCKED → DEVELOPING` run the admission rules in
`evaluateAdmission` (ADR-054 D4):

- `acceptanceCriteria` is non-blank;
- the task has no `parentId` (a design unit aggregates children, it does not start);
- a `DESIGNED` task carries a `designRef`;
- `scopePaths` is non-empty and holds at most 20 globs;
- every `dependsOn` entry exists and is `COMPLETED`.

When a rule fails the request is not rejected with an error: the task lands in
`BLOCKED` with `blockedReason` prefixed `gate 1:`, and `TASK_STATUS_CHANGED_EVENT`
notifies the host. Creating a task directly in `DEVELOPING` runs the same rules.

`designRef` resolvability and its repository relevance are host checks: they need
the workspace decision documents, so the host prefilter owns them.

## Plan freeze and override

`planFrozenAt` is stamped the first time a task enters `DEVELOPING` from
`PENDING` or `BLOCKED`. From then on `impact` and `scopePaths` (and therefore the
derived `changeClass`) are frozen. Updating either field requires
`planOverrideReason`; without it the update is rejected with `409`. An accepted
override emits `TASK_PLAN_OVERRIDE_EVENT` so the host can write the audit row.
Who is allowed to override is enforced at the executor boundary, not here.

## Events

`TaskService.updateTask` emits `TASK_STATUS_CHANGED_EVENT` (`task-management.status-changed`) via `EventEmitter2` after a validated status transition. Same-status updates and non-status edits do not emit.

It also emits `TASK_PLAN_OVERRIDE_EVENT` (`task-management.plan-override`) when a frozen plan edit is accepted, carrying `taskId`, `spaceId`, `fields`, `reason`, `operatorParticipantId`, `operatorName` and `frozenAt`. Both events are declared in `taskManagementEventDeclarations` and activated by the host's event-declarations wiring.

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
