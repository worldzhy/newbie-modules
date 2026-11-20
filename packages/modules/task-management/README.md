# newbie.task-management

## Models

| Model            | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `Task`           | Work item owned by a host project (`projectId`), soft-deleted          |
| `TaskActor`      | HUMAN (account user) or CREWMATE (worker) that acts on tasks           |
| `TaskDependency` | Prerequisite edge: `taskId` waits for `prerequisiteTaskId` to complete |

`Task.projectId` is an opaque host project id; the host adds the `Project`
relation on top of the scalar. The host also adds the opaque `userId` /
`crewmateId` scalars (with unique indexes) to `TaskActor`: a HUMAN actor carries
`userId`, a CREWMATE actor carries `crewmateId`, and exactly one of the two is
set (checked by the service, since Prisma cannot express the one-of constraint).

## Delivery-plan fields

Tasks carry the delivery-plan fields from ADR-054 D2 so every host that runs the
delivery pipeline shares the same vocabulary:

| Field                          | Meaning                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `parentId`                     | Parent task; a task with a parent is a design unit, not started                |
| `designReference`              | Design source reference (ADR / spec id or path)                                |
| `designReviewRequired`         | Derived flag: the task needs a design review before it may start               |
| `acceptanceCriteria`           | Acceptance criteria, required before a task may start                          |
| `allowedPaths`                 | Allowed path globs; also the measurement for `designReviewRequired`            |
| `changeImpact`                 | Declared impact (`repos`, `touchesSchema`, `touchesContracts`, `irreversible`) |
| `prerequisiteTaskIds`          | Prerequisite task ids that must reach `COMPLETED` first                        |
| `originReference`              | Origin discussion reference (`chatId`, `messageId`)                            |
| `blockedReason`                | Required when a task moves to `BLOCKED`                                        |
| `designReferenceJustification` | Why the change falls inside the `designReference` scope                        |
| `requirementReview`            | Requirement-review summary from the discussion stage                           |
| `planFrozenAt`                 | When the plan froze; null until the task first starts                          |

`designReviewRequired` is computed by `deriveDesignReviewRequired(changeImpact,
allowedPaths)`: true when the task spans several repositories, touches the schema
or a contract, is irreversible, or declares more than 20 allowed path globs.

Prerequisites live in `TaskDependency` join rows (composite primary key
`taskId + prerequisiteTaskId`); the API exposes them as `prerequisiteTaskIds`.

## Status transitions

`BLOCKED` means a gate stopped the task and a human must clear it:

- `PENDING → DEVELOPING | BLOCKED | CANCELLED`
- `DEVELOPING → TESTING | BLOCKED | CANCELLED`
- `TESTING → DEVELOPING | MERGED | BLOCKED | CANCELLED`
- `MERGED → DEVELOPING | DEPLOYED | BLOCKED | CANCELLED`
- `DEPLOYED → DEVELOPING | BLOCKED | COMPLETED | CANCELLED`
- `BLOCKED → DEVELOPING | CANCELLED`
- `COMPLETED` and `CANCELLED` are terminal.

A transition into `BLOCKED` is rejected unless `blockedReason` is supplied.

## Gate 1: start admission

`PENDING → DEVELOPING` and `BLOCKED → DEVELOPING` run the admission rules in
`evaluateAdmission` (ADR-054 D4):

- `acceptanceCriteria` is non-blank;
- the task has no `parentId` (a design unit aggregates children, it does not start);
- when `designReviewRequired` is true the task carries a `designReference`;
- `allowedPaths` is non-empty and holds at most 20 globs;
- every prerequisite task exists and is `COMPLETED`.

When a rule fails the request is not rejected with an error: the task lands in
`BLOCKED` with `blockedReason` prefixed `gate 1:`, and `TASK_STATUS_CHANGED_EVENT`
notifies the host. Creating a task directly in `DEVELOPING` runs the same rules.

`designReference` resolvability and its repository relevance need the workspace
decision documents, so the module asks the host through an optional port:

```ts
export interface TaskPlanAdjudicator {
  adjudicate(input: PlanAdjudicationInput): Promise<PlanAdjudicationVerdict>;
}
```

Bind `TASK_PLAN_ADJUDICATOR` in a host module to run those checks; without a
binding only the record-level rules above apply. When a bound adjudicator
refuses, the task still lands in `BLOCKED` with the `gate 1:` prefix, and the
host's reason is appended to the violations. `PlanAdjudicationInput` carries
`designReference`, `designReferenceJustification` and `changeImpactRepos`, so the
host decides resolvability, supersession and whether the design's affected
repositories intersect `changeImpact.repos`; a `designReferenceJustification` is
the human escape hatch and admits the task without further checks.

## Plan freeze and override

`planFrozenAt` is stamped the first time a task enters `DEVELOPING` from
`PENDING` or `BLOCKED`. From then on `changeImpact` and `allowedPaths` (and
therefore the derived `designReviewRequired`) are frozen. Updating either field
requires `planOverrideReason`; without it the update is rejected with `409`. An
accepted override emits `TASK_PLAN_OVERRIDE_EVENT` so the host can write the
audit row.

The same applies to writing a non-empty `designReferenceJustification`, the
escape hatch that lets gate 1 skip its `designReference` checks. Both writes
require the virtual permission atom `TaskPlanOverride:Update` (ADR-054 D3: "only
a human may override, the agent has no write permission"); `Task:Update` alone
is refused with `403`. The service asks the bound `PERMISSION_AUTHORIZER`
directly — the atom has no route decorator — and fails closed when no actor or
authorizer is available. Hosts therefore grant it to ADMIN only: seed it as an
`extraResources` entry with the whole atom set in another group's `excludeAtoms`.
When identities carry a HUMAN/AGENT kind (ADR-056), that check can narrow to the
kind instead of the administrative role.

## Events

`TaskService.updateTask` emits `TASK_STATUS_CHANGED_EVENT`
(`task-management.status-changed`) via `EventEmitter2` after a validated status
transition. Same-status updates and non-status edits do not emit.

It also emits `TASK_PLAN_OVERRIDE_EVENT` (`task-management.plan-override`) when a
frozen plan edit is accepted, carrying `taskId`, `projectId`, `fields`, `reason`,
`operatorActorId`, `operatorName` and `frozenAt`. Both events are declared in
`taskManagementEventDeclarations` and activated by the host's event-declarations
wiring.

Payload (`TaskStatusChangedEvent`):

| Field            | Description                        |
| ---------------- | ---------------------------------- |
| `taskId`         | Task id                            |
| `title`          | Task title after the update        |
| `projectId`      | Owning project id                  |
| `previousStatus` | Status before the transition       |
| `status`         | Status after the transition        |
| `operatorName`   | Actor display name of the operator |

The module does not know about projects beyond their opaque id; hosts subscribe
with `@OnEvent(TASK_STATUS_CHANGED_EVENT)` and route alerts themselves.

## HTTP surface

| Route                                         | Purpose                                     |
| --------------------------------------------- | ------------------------------------------- |
| `GET /tasks?projectId=`                       | List a project's tasks                      |
| `GET /tasks/:taskId`                          | Read one task with actors and prerequisites |
| `POST /tasks?projectId=`                      | Create one task                             |
| `POST /tasks/batch`                           | Create tasks in a project                   |
| `PATCH /tasks/:taskId`                        | Update a task (validated transitions)       |
| `DELETE /tasks/:taskId`                       | Soft delete a task                          |
| `GET /task-actors`                            | List actors                                 |
| `GET /task-actors/by-user-id?userId=`         | Look up a HUMAN actor                       |
| `GET /task-actors/by-crewmate-id?crewmateId=` | Look up a CREWMATE actor                    |
| `GET /task-actors/members?projectId=`         | Actors of a project with task stats         |
