# newbie.evaluation

The evaluation capability skeleton (newbie-modules ADR-020): seven tables, four
ports, and the invariants every evaluation feature shares. `work-evaluation`
(ADR-021) and `security-evaluation` (ADR-022) are the features built on top of
it; this module knows neither of them.

## Vocabulary

One concept, one word.

- **subject** (`EvaluationSubject`) — the thing being evaluated. `kind` is
  feature-defined (`work`, `repository`, `cloud-resource`), `subjectKey` is the
  feature's stable natural identity inside the host's `scopeType` / `scopeId`
  coordinate. The coordinate is a plain scalar with no foreign key.
- **criteria version** (`EvaluationRuleSetVersion`) — a frozen set of
  criteria. Drafts are editable; publishing is one-way. Runs only reference
  published versions.
- **criterion** (`EvaluationCriterion`) — one entry of a version, `SCORED` or
  `ASSERTION`. `criterionKey` is what verdicts and findings reference.
- **run** (`EvaluationRun`) — one attempt against one version. At most one
  active run per (subject, version).
- **verdict** — the product of a `SCORED` criterion, stored inside
  `EvaluationResult`. Periodic, immutable, never closed.
- **review** (`EvaluationResult.reviewStatus`) — the supervisor's explicit
  verdict on an archived result (ADR-031): APPROVED endorses the AI
  conclusion, REJECTED overrules it. The snapshot never changes; a re-review
  overwrites the previous review, so the row always reflects exactly the
  latest say.
- **finding** (`EvaluationFinding`) — the product of an `ASSERTION` criterion.
  Identity is `(subject, evaluationKey, fingerprint)`: `evaluationKey` is copied from the
  run's criteria version, so a rerun under a new version of the same evaluationKey
  keeps the finding alive, and one evaluationKey's run never resolves another
  evaluationKey's findings. Two versions of one evaluationKey may run concurrently, so
  resolution and re-observation are compare-and-set writes — a human
  suppression, or a re-observation by the concurrent run, is never
  overwritten.
- **remediation plan** (`EvaluationRemediationPlan`) — the object that answers
  to findings or results of one subject, with a named decider.

Actor references follow the `*ByRef` naming: `requestedByRef` on a run,
`suppressedByRef` on a suppressed finding, `reviewedByRef` on a reviewed
result, `decidedByRef` on a closed plan. They are opaque host-side actor ids —
plain scalars, no foreign keys. Note the distinction on a plan: `deciderRef`
names the accountable decision maker, `decidedByRef` records who actually
recorded the decision.

Verdict and finding are deliberately not merged: closing a score makes no
sense, and tracking a problem inside a JSON blob makes it untrackable.

## Tables

| Table                       | Owns                                                        |
| --------------------------- | ----------------------------------------------------------- |
| `EvaluationRuleSetVersion`  | kind / evaluationKey / version, publication state           |
| `EvaluationCriterion`       | criterion key, kind, name, feature-defined metadata         |
| `EvaluationSubject`         | kind, scope coordinate, subject key, display name           |
| `EvaluationRun`             | state machine, failure reason, actor reference              |
| `EvaluationResult`          | manifest, content hash, coverage, verdicts, review          |
| `EvaluationFinding`         | evaluationKey + fingerprint identity, severity, suppression |
| `EvaluationRemediationPlan` | trigger refs, decider, checkpoints, decision                |

## Invariants (ADR-020 D5)

1. **Result snapshots are immutable.** `EvaluationResultService` has no update
   path for the archived snapshot; a rerun is a new run and a new row.
   `contentHash` is computed by the skeleton from the manifest, never accepted
   from the caller. The one write path the service does have is the supervisor
   review (ADR-031), which touches only the review columns and never the
   snapshot.
2. **Coverage is always explainable.** `composeCoverageStats` derives the
   evaluated bucket from the evidence ids the judgment examined and merges every
   skipped bucket (collector + judgment budget). An evaluated ref that names no
   collected item is reported as a problem and the run is rejected — never
   silently bucketed under an "unknown" source. `validateCoverageStats` rejects
   a skipped bucket with `total > 0` unless it names the dropped items and
   explains why, rejects a skipped item list that disagrees with the total,
   rejects an unexplained `declaredUnlinked` gap, and — when given the manifest
   ids — rejects evaluated items outside the manifest. Verdict and finding
   `evidenceRefs` must likewise resolve to manifest items.
3. **No composite score.** The result table has no total field and the module
   exposes no weighted-merge endpoint; multi-axis scores belong to features.
4. **Run concurrency is a database constraint.** Prisma cannot express a partial
   unique index, so the consumer migration must declare it:

   ```sql
   CREATE UNIQUE INDEX "EvaluationRun_one_active_per_subject_version"
     ON "module/evaluation"."EvaluationRun" ("subjectId", "ruleSetVersionId")
     WHERE "status" IN ('QUEUED', 'RUNNING');
   ```

   Without this index the invariant is not enforced — a second concurrent run
   only fails inside the process that received it, which is exactly the failure
   mode this skeleton replaces.

   Liveness around the constraint is two-sided: the runner heartbeats the row
   while a judgment works (a long judgment must not look abandoned to the
   stale-run reaper), and a fencing check before every write stops the runner
   if the row was closed or reaped underneath it. The terminal transitions
   themselves are conditional writes whose matched-row count is checked, so a
   transition that lost the race conflicts instead of reporting a state the
   row never reached. The reaper is built in (ADR-038): an unref'd interval
   started at module init sweeps abandoned active rows globally, fails them
   with a shared error text and publishes their terminal events — an abandoned
   run can no longer sit `RUNNING` forever, and admission never double-duties
   as the sweeper. The reaper timeout, the sweep interval and the heartbeat
   interval are host-tunable via `evaluationRunOptionsToken`.

5. **Published criteria are read-only.** Version updates are conditional writes
   (`WHERE publishedAt IS NULL`); criterion adds, updates and removals lock the
   version row `FOR UPDATE` inside a transaction, so a concurrent publication
   cannot slip a mutation past the check. Publication itself is a conditional
   update and refuses a version with zero criteria — an empty rubric would make
   every run vacuous.

## Ports

The module never calls a model, never reads a host table, and never collects
evidence. Features and hosts bind the ports under these tokens:

| Port                 | Token                         | Bound by | Required |
| -------------------- | ----------------------------- | -------- | -------- |
| `SubjectProvider`    | `subjectProviderToken`        | host     | yes      |
| `CriteriaProvider`   | `criteriaProviderToken(kind)` | feature  | yes      |
| `EvidenceProvider`   | `evidenceProviderToken(kind)` | feature  | yes      |
| `JudgmentPort`       | `judgmentPortToken(kind)`     | feature  | yes      |
| `EvaluationObserver` | `evaluationObserverToken`     | host     | no       |

The observer reports run completions and finding lifecycle changes (created /
reopened / resolved / suppressed) to whoever binds it — notifications, metrics,
audit. No binding means no notifications, and an observer failure never fails a
run; a host that needs reliable delivery should back its observer with a
durable outbox.

Kind-scoped tokens follow the `installationResolverToken(kind)` precedent: a
feature that evaluates two subject kinds binds the same instance under both.
`EvaluationProviderRegistry` resolves them lazily, so this module carries no
compile-time dependency on any feature.

`EvaluationRunnerService` is the only write entry of the run lifecycle, in two
halves: `open` takes the admission decision synchronously (subject existence,
rule-set-version applicability, and the one-active-run conflict decided by the
database — so a trigger can still answer 400/404/409 before accepting the
request), and `execute` runs the opened row — collect evidence, judge, compose
coverage, persist the immutable result, upsert findings, resolve absent
findings, close the run — with the heartbeat and fencing checks described under
invariant 4. `run` is the convenience pair of both for callers that await the
whole run. A feature that implements the four ports inherits all of it and must
not drive the run state machine through `EvaluationRunService` directly.

A run may carry an opaque per-run `config` (ADR-023): the trigger passes it to
`startRun`, it is stored on the run row and threaded symmetrically to all three
feature ports (ADR-026) — `CriteriaProvider.selectVersion(subject, runConfig?)`
receives it when the feature picks the applicable version,
`EvidenceProvider.collect(subject, ruleSetVersion, runConfig?)` receives it at
collection time, and the judgment port reads it as `JudgmentInput.runConfig`.
The skeleton never reads a key from it — model selection, period windows,
budget overrides and similar knobs are feature-defined. The
judgment's `metadata` (which model, scope and prompt version actually ran) is
persisted verbatim into `EvaluationResult.metadata`, so results of different
runs stay comparable. Config holds small knobs only; large material follows
the evidence-payload rule below.

The result row is persisted before the run is closed, so a process crash in
between leaves a run the reaper eventually fails while its result row already
exists. A FAILED run with a result is a possible, self-consistent state and
readers must tolerate it.

## Run lifecycle events

The skeleton declares two events, and only the runner emits them — after the
terminal row is written (ADR-032):

| Event                      | Fired when                                            |
| -------------------------- | ----------------------------------------------------- |
| `evaluation.run-succeeded` | the run is SUCCEEDED and its result is archived       |
| `evaluation.run-failed`    | the run is FAILED and its failure reason is persisted |

The payload carries identity and terminal state only — `runId`, `subjectId`,
`subjectKind`, `ruleSetVersionId`, `evaluationKey`, `status` and, on failure, `error`
with the same text and truncation as the run row. Findings and coverage are
deliberately absent: they are mutable read models, so a consumer queries the
existing endpoints by `runId` / `subjectId` when it needs detail.

Features must not emit these events themselves — one run has one event source.
The declarations live in `evaluation.events.ts`; activating them in the event
catalog is the host's decision (ADR-028). A publish failure is logged and
swallowed; it never changes the run's terminal state.

## Evidence payloads

`EvaluationEvidenceItem.payload` is for small intrinsic values only — a version
string, a flag, a count. Large material (documents, transcripts, scan dumps)
lives in the feature's own storage and is referenced through `refs`; the
archived manifest must stay a manifest, not a data dump.

## Subject sync

`EvaluationSubjectService.syncSubjects` is upsert-only: subjects the host stops
listing are not deleted. Removal semantics belong to the first feature that
actually needs them.

## Scope

One controller only (ADR-029): the decision surface over skeleton-owned
aggregates — finding suppression/reopening, result review (ADR-031) and
remediation plans. Read models,
feature endpoints, notification templates and scheduling belong to the feature.
No `llm` dependency: deterministic judgments
(version ranges, configuration baselines) must not be pulled into the LLM stack,
and features that do need a model inject their own judgment port implementation
(ADR-018 stays valid at the feature level).

## Tests

`evaluation-invariants.test.ts` covers the rules that must hold before a write:
manifest hashing, coverage composition and validation, criteria immutability,
and verdict/finding consistency. It runs with the Node test runner and needs no
database:

```bash
node --import tsx --test packages/modules/evaluation/evaluation-invariants.test.ts
```

The run-concurrency invariant is a migration-time property and is verified with
the consumer's database once the module is assembled.
