# newbie.people-evaluation

> **Frozen (ADR-021, 2026-10-26).** This module is superseded by
> [`work-evaluation`](../work-evaluation/README.md), the first feature module on the
> generic `evaluation` skeleton (ADR-020). No new development happens here; the
> package is kept only as the historical record of the people-specific design.

Evidence-driven performance evaluation: rubric and period administration, evidence
ingest, archived evaluation results and PIP plans. The design source is devbie
ADR-030 (vocabulary), devbie ADR-032 (result-centric evidence) and the host-level
ADR-029 in nightwatch-backend.

## Vocabulary

One concept, one word.

- `installation` — the member-side agent that reports evidence. `worklog` is the
  CLI product name (`@devbie/worklog`) only; it is never a module concept.
- `workspace`, `session`, `declared document` — the three reported evidence kinds.
- `result` (`PeopleEvaluationResult`) — one evaluation run. There is no second
  "assessment" concept: the run, its judgments and the material snapshot it was
  judged from are one row.
- `manifest` — the archived material snapshot of a result, read back through
  `GET /people/evaluation-results/:id/manifest`.

The person being evaluated is `evaluateeUserId` everywhere — `memberUserId` is
retired.

## Naming rules

- An **Entity** is a Prisma model: it has a table, a primary key and relations.
- A **DTO** is a transport shape: request bodies, response bodies, nested objects
  and batch array elements. Nested and batch element DTOs are DTOs, not entities.
- Prisma models keep the `PeopleEvaluation` prefix (they live in the global model
  namespace): `PeopleEvaluationInstallation`, `PeopleEvaluationResult`.
- DTOs carry the module prefix plus an operation prefix:
  - request: `<Operation>PeopleEvaluation<Concept>RequestDto`
  - response: `PeopleEvaluation<Concept>ResponseDto`
  - list: `ListPeopleEvaluation<Concept>sRequestDto` / `...ResponseDto`
  - batch envelope: `CreatePeopleEvaluation<Concept>BatchRequestDto`
  - nested / batch element: `PeopleEvaluation<Concept>Dto`
  - internal service input that is not an HTTP payload: `...Input`
- Verbs belong to requests only. Responses are nouns; never `CreateXxxResponseDto`.
- A list response's row type is the plain `ResponseDto` of that resource.
- One payload, one DTO: the batch element DTO is both the controller input and the
  service input. Do not declare a second shape for the same payload.

## Routes

| Prefix                                                               | Auth                                              | Purpose                                             |
| -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `/people/evidence/{workspaces,sessions,documents}` (POST)            | installation token (`kind` = `people-evaluation`) | Ingest reported workspaces, sessions and documents  |
| `/people/evidence/{workspaces,sessions,documents}` (GET)             | platform JWT + model permission                   | Read back what was reported                         |
| `/people/installations`                                              | platform JWT                                      | Enroll, list, rotate and revoke installation agents |
| `/people/{rubrics,periods,home-ground,evaluation-results,pip-plans}` | platform JWT                                      | Evaluation administration                           |
| `/people/evaluation-results/:id/manifest`                            | platform JWT                                      | Archived material snapshot of one result            |

Ingest payloads carry no evaluatee identity: the installation token resolves to
exactly one evaluatee, so there is no second identity source to reconcile.

## Tokens

One random UUID token per installation, stored as a SHA-256 hash. The plaintext is
returned exactly once — on creation and on `POST /people/installations/:id/token/regenerate`
(both answer `PeopleEvaluationInstallationCredentialResponseDto`). Reads never carry
the token, and `DELETE /people/installations/:id` is a soft revocation: later ingest
requests get 401, reported evidence is retained. Revocation and rotation take effect
on the next request: valid tokens are not cached, only rejected ones are (10s negative
cache). The installation agent's configuration is assembled client-side as
`{ endpoint, token }`.

## Results

A rerun writes a new result row; the snapshot of an older row is never replaced.
Each result stores `manifest`, `coverageStats` and `contentHash` (SHA-256 over the
canonical manifest) alongside the model's judgments.

Audit replay (re-playing the model's tool trace) is not supported yet: the tool trace
is not persisted.
