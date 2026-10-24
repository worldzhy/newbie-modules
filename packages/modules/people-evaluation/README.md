# newbie.people-evaluation

Evidence-driven performance evaluation: rubric and period administration, worklog
ingest, evidence packets and assessments. The design source is devbie ADR-030
(vocabulary) and the host-level ADR-029 in nightwatch-backend.

## Vocabulary

One concept, one word. The member-side agent, the ingest routes, the Prisma model
and the logs all say `worklog`; there is no separate "collector" vocabulary. The
person being evaluated is `evaluateeUserId` everywhere — `memberUserId` is retired.

## Naming rules

- Prisma models keep the `PeopleEvaluation` prefix (they live in the global model
  namespace): `PeopleEvaluationWorklogInstallation`.
- DTOs drop that prefix — they only exist inside this module.
- Verbs belong to requests only. Responses are nouns: `PeriodResponseDto`,
  `RubricVersionResponseDto`; never `CreateXxxResponseDto`.
- A list response's row type is the plain `XxxResponseDto` of that resource.
- One payload, one DTO: `Worklog{Workspace,Session,Document}ItemDto` is both the
  controller input and the service input. Do not declare a second shape for the
  same payload.

## Routes

| Prefix                                                        | Auth                                              | Purpose                                               |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `/people/worklog/{workspaces,sessions,documents}`             | installation token (`kind` = `people-evaluation`) | Ingest reported workspaces, sessions and documents    |
| `/people/worklog/{workspaces,sessions,documents}` (GET)       | platform JWT + model permission                   | Read back what was reported                           |
| `/people/worklog/installations`                               | platform JWT                                      | Enroll, list, rotate and revoke member worklog agents |
| `/people/{rubrics,periods,home-ground,assessments,pip-plans}` | platform JWT                                      | Evaluation administration                             |

## Tokens

One random UUID token per installation, stored as a SHA-256 hash, returned in
plaintext exactly once. Revocation and rotation take effect on the next request:
valid tokens are not cached, only rejected ones are (10s negative cache).
