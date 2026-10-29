# newbie.work-evaluation

Evidence-driven evaluation of one person's actual work over one period: period
administration, evidence ingest from member-side installations, and blind
three-phase model judgment. This is the first feature module built on the
`evaluation` skeleton (ADR-020) with subject kind `"work"`, and it replaces the
frozen `people-evaluation` module as the go-forward implementation
(ADR-021, ADR-024). The design sources are devbie ADR-030 (vocabulary) and
ADR-032 (result-centric evidence).

`worklog` is the collector agent's product name (`@devbie/worklog`); `work` is
the kind of the subject being evaluated. One is a CLI, the other is a skeleton
vocabulary word — never mix them.

## Vocabulary

One concept, one word.

- `installation` — the member-side agent that reports evidence. `worklog` is the
  CLI product name only; it is never a module concept.
- `workspace`, `session`, `declared document` — the three reported evidence
  kinds. All of it is `declared`-layer evidence.
- `subject` — the evaluatee inside the evaluation skeleton, kind `"work"`.
- `run` / `result` — one evaluation attempt and its immutable archived outcome.
  Both live in the skeleton (`EvaluationRun` / `EvaluationResult`); this module
  owns no run or result table.
- `manifest` — the archived evidence snapshot of a result, read back through the
  skeleton's result endpoints.
- `home ground` — the evaluatee's declared specialty circle: a set of
  criterion keys that is context for the judgment, never a scoring input.

The person being evaluated is `evaluateeUserId` everywhere.

## Module dependencies

`account`, `audit`, `security`, `llm`, `clickhouse`, `evaluation`.

## Naming rules

- An **Entity** is a Prisma model: it has a table, a primary key and relations.
- A **DTO** is a transport shape: request bodies, response bodies, nested objects
  and batch array elements. Nested and batch element DTOs are DTOs, not entities.
- Prisma models keep the `WorkEvaluation` prefix (they live in the global model
  namespace): `WorkEvaluationInstallation`, `WorkEvaluationSession`.
- DTOs carry the module prefix plus an operation prefix:
  - request: `<Operation>WorkEvaluation<Concept>RequestDto`
  - response: `WorkEvaluation<Concept>ResponseDto`
  - list: `ListWorkEvaluation<Concept>sRequestDto` / `...ResponseDto`
  - batch envelope: `CreateWorkEvaluation<Concept>BatchRequestDto`
  - nested / batch element: `WorkEvaluation<Concept>Dto`
  - internal service input that is not an HTTP payload: `...Input`
- Verbs belong to requests only. Responses are nouns; never `CreateXxxResponseDto`.
- A list response's row type is the plain `ResponseDto` of that resource.
- One payload, one DTO: the batch element DTO is both the controller input and the
  service input. Do not declare a second shape for the same payload.

## Data model

Six PostgreSQL tables under `@@schema("module/work-evaluation")`, plus one
ClickHouse table for transcripts:

| Table                                           | Owns                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `WorkEvaluationPeriod`                          | COLLECTION / REVIEW periods, status machine, pinned criteria version |
| `WorkEvaluationHomeGround`                      | one evaluatee's specialty-circle declaration per period              |
| `WorkEvaluationWorkspace`                       | declared workspaces (the ingest allowlist)                           |
| `WorkEvaluationSession`                         | per-session index rows: stats, tool names, touched files             |
| `WorkEvaluationDeclaredDocument`                | member-declared artifacts (design notes, research, prototypes)       |
| `WorkEvaluationInstallation`                    | agent enrollment: token hash, evaluatee binding, soft revocation     |
| `work_evaluation_session_messages` (ClickHouse) | session transcripts the judgment drills into on demand               |

`WorkEvaluationPeriod.ruleSetVersionId` pins each period to exactly one
published criteria version of kind `"work"`. It is a plain scalar with no
relation — foreign keys never cross schema boundaries.

## Subject convention

For kind `"work"`, `subjectKey = "<evaluateeUserId>"` and the scope coordinate
is the member themself (`scopeType = "user"`, `scopeId = userId`). Subjects are
registered lazily: `POST /work-evaluation/runs` takes `{ evaluateeUserId,
periodId }` and upserts the subject row on first trigger (ADR-026 D2). The
period is a **run-level** parameter carried on `run.config.periodId` — it picks
the evidence window and resolves the pinned criteria version, and it never
enters the subject identity, so one member keeps one subject across periods and
findings do not fragment per cycle. Subject metadata is unused by this feature;
the identity tokens that keep the judgment blind (registered emails,
linked-account display names, profile name) are resolved live from the account
at judgment time. The subject `displayName` is masked too.

## Port bindings

The module binds the three kind-scoped feature ports of the evaluation skeleton
via `useExisting`:

- `criteriaProviderToken("work")` — resolves the run's `config.periodId` to the
  period's pinned `{ evaluationKey, version }` of its criteria version.
- `evidenceProviderToken("work")` — collects the evidence manifest for one run
  over the period's window.
- `judgmentPortToken("work")` — the three-phase model judgment below.

The installation-token resolver binds `installationResolverToken("work-evaluation")`,
so ingest endpoints authenticate with the module's own installation tokens.

## Evidence buckets

All reported items are `layer: "declared"`; item ids keep their ingest prefixes
(`workspace:<uuid>` / `session:<uuid>` / `document:<uuid>` /
`home-ground:<uuid>`). `payload` carries small intrinsic values only (stats,
refs); transcripts and document bodies stay in ClickHouse / PostgreSQL and are
read on demand by the judgment's drill-down tools — the manifest stays a
manifest.

- `declaredUnlinked` — sessions and documents whose `workspaceKey` is outside
  the declared workspace set, with a note and the item ids.
- `skipped` — sessions whose transcript fetch failed (ClickHouse outage), with
  a note and the item ids. Missing evidence must always be explainable.

## Blind judgment

The judgment port runs three phases against the llm module's chat port:

1. **Advocate** — finds the strongest supportable highlights, citing evidence ids.
2. **Skeptic** — attacks the evidence base and the advocate's case, listing
   numbered challenges.
3. **Synthesis** — answers every challenge, judges each SCORED criterion
   independently, and returns the verdict JSON. A criterion the model did not
   answer produces no verdict — absence is the honest signal, never a
   placeholder zero.

The model only ever sees a blind subject id. Every tool response passes through
the drill redactor before it reaches the model: the evaluatee's identity tokens
(emails case-insensitively, names literally, longest first) become `[subject]`,
and credentials (cloud keys, provider tokens, private key blocks, JWTs,
assigned secrets) become `[REDACTED]`. The secret pattern list mirrors the
collector-side scrubber in `@devbie/worklog` — change both or change neither.

Per-phase token budgets, wall-clock ceilings and a tool-round cap bound the
loop; a phase that stops on budget, time or rounds must list what it skipped.

### Run-level config (ADR-023)

`POST /work-evaluation/runs` accepts an opaque `config` object that the skeleton
threads to the judgment port as `runConfig`. Two small knobs are defined:

- `config.modelScope` — overrides the llm scope this run resolves its chat model
  from (default `"work-evaluation"`).
- `config.budget` — partial per-phase token budget override, merged over
  `DEFAULT_WORK_EVALUATION_PHASE_BUDGET`.

Multi-model evaluation is a first-class capability expressed as sequential runs
with different `modelScope` values. Each judgment records
`metadata = { model, scope, promptVersion, tokenUsage }`, which the skeleton
persists verbatim into `EvaluationResult.metadata`, so results across models
stay comparable. There is no dual-model disagreement machinery.

## Routes

The authoritative route list is the module spec
(`.trae/specs/work-evaluation-module/spec.md`, §3 and §5). Planned surface:

| Prefix                                                              | Auth                                            | Purpose                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `/work-evaluation/evidence/{workspaces,sessions,documents}` (POST)  | installation token (`kind` = `work-evaluation`) | Ingest reported workspaces, sessions, documents; answers 204 |
| `/work-evaluation/installations`                                    | platform JWT                                    | Enroll, list, rotate and revoke installation agents          |
| `/work-evaluation/{rule-set-versions,periods,home-ground,subjects}` | platform JWT                                    | Evaluation administration                                    |
| `/work-evaluation/runs`                                             | platform JWT                                    | Trigger and list runs                                        |
| `/work-evaluation/results`                                          | platform JWT                                    | Read archived results                                        |

`POST /work-evaluation/runs { evaluateeUserId, periodId, requestedByRef?, config? }`
follows the skeleton's two-phase contract (ADR-029): admission — period
eligibility, evaluatee existence, published criteria version, no active run —
is answered synchronously as 400/404/409 before the 202; the judgment
execution then continues in the background. Clients observe progress by
polling `GET /work-evaluation/runs?subjectId=` (newest first).

Ingest payloads carry no evaluatee identity: the installation token resolves to
exactly one evaluatee, so there is no second identity source to reconcile.

## Tokens

One random UUID token per installation, stored as a SHA-256 hash. The plaintext
is returned exactly once — on creation and on token regeneration. Reads never
carry the token, and deletion is a soft revocation: later ingest requests get
401, reported evidence is retained. Revocation and rotation take effect on the
next request: valid tokens are not cached, only rejected ones are (10s negative
cache). The installation agent's configuration is assembled client-side as
`{ endpoint, token }`. An installation is considered online when it was seen
within the last 180 seconds.

## Run lifecycle

The run state machine, heartbeat, fencing, stale-run reaping, coverage
composition and result immutability all belong to the evaluation skeleton — see
`packages/modules/evaluation/README.md`. This module only implements the ports.

## Out of scope

Dropped per ADR-024, deliberately absent from this module:

- Result review fields (`reviewedBy` / `reviewNote`) and any review table.
- `PipPlan` and remediation endpoints.
- Dual-model disagreement handling (sequential runs replace it).
- Fact-layer evidence sources (github / bitbucket / incident) and their tools.
- Top-level `highlights` / `risks` / `unresolved` result fields — verdicts and
  the summary carry the judgment.
- Frontend pages.

## Tests

The prompt contract and the drill redactor are pure functions with zero runtime
dependencies, tested without a database or a model:

```bash
node --import tsx --test \
  packages/modules/work-evaluation/work-evaluation-judgment.prompt.test.ts \
  packages/modules/work-evaluation/work-evaluation-redaction.test.ts
```
