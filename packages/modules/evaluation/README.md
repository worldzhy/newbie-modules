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
- **criteria version** (`EvaluationCriteriaVersion`) — a frozen set of
  criteria. Drafts are editable; publishing is one-way. Runs only reference
  published versions.
- **criterion** (`EvaluationCriterion`) — one entry of a version, `SCORED` or
  `ASSERTION`. `criterionKey` is what verdicts and findings reference.
- **run** (`EvaluationRun`) — one attempt against one version. At most one
  active run per (subject, version).
- **verdict** — the product of a `SCORED` criterion, stored inside
  `EvaluationResult`. Periodic, immutable, never closed.
- **finding** (`EvaluationFinding`) — the product of an `ASSERTION` criterion.
  Has a `fingerprint` identity and a lifecycle across runs.
- **remediation plan** (`EvaluationRemediationPlan`) — the object that answers
  to findings or results of one subject, with a named decider.

Verdict and finding are deliberately not merged: closing a score makes no
sense, and tracking a problem inside a JSON blob makes it untrackable.

## Tables

| Table                       | Owns                                                   |
| --------------------------- | ------------------------------------------------------ |
| `EvaluationCriteriaVersion` | kind / family / version, publication state             |
| `EvaluationCriterion`       | criterion key, kind, name, feature-defined metadata    |
| `EvaluationSubject`         | kind, scope coordinate, subject key, display name      |
| `EvaluationRun`             | state machine, failure reason, actor reference         |
| `EvaluationResult`          | manifest, content hash, coverage, verdicts             |
| `EvaluationFinding`         | fingerprint identity, severity, lifecycle, suppression |
| `EvaluationRemediationPlan` | trigger refs, decider, checkpoints, decision           |

## Invariants (ADR-020 D5)

1. **Result snapshots are immutable.** `EvaluationResultService` has no update
   path; a rerun is a new run and a new row. `contentHash` is computed by the
   skeleton from the manifest, never accepted from the caller.
2. **Coverage is always explainable.** `composeCoverageStats` derives the
   evaluated bucket from the evidence ids the judgment examined and merges every
   skipped bucket (collector + judgment budget). `validateCoverageStats` rejects
   a skipped bucket with `total > 0` unless it names the dropped items and
   explains why, and rejects an unexplained `declaredUnlinked` gap.
3. **No composite score.** The result table has no total field and the module
   exposes no weighted-merge endpoint; multi-axis scores belong to features.
4. **Run concurrency is a database constraint.** Prisma cannot express a partial
   unique index, so the consumer migration must declare it:

   ```sql
   CREATE UNIQUE INDEX "EvaluationRun_one_active_per_subject_version"
     ON "module/evaluation"."EvaluationRun" ("subjectId", "criteriaVersionId")
     WHERE "status" IN ('QUEUED', 'RUNNING');
   ```

   Without this index the invariant is not enforced — a second concurrent run
   only fails inside the process that received it, which is exactly the failure
   mode this skeleton replaces.

5. **Published criteria are read-only.** Every mutation checks `publishedAt`
   through `isCriteriaVersionMutable`; publication itself is a conditional
   update, so two concurrent publications cannot both win.

## Ports

The module never calls a model, never reads a host table, and never collects
evidence. Features and hosts bind the ports under these tokens:

| Port               | Token                         | Bound by |
| ------------------ | ----------------------------- | -------- |
| `SubjectProvider`  | `subjectProviderToken`        | host     |
| `CriteriaProvider` | `criteriaProviderToken(kind)` | feature  |
| `EvidenceProvider` | `evidenceProviderToken(kind)` | feature  |
| `JudgmentPort`     | `judgmentPortToken(kind)`     | feature  |

Kind-scoped tokens follow the `installationResolverToken(kind)` precedent: a
feature that evaluates two subject kinds binds the same instance under both.
`EvaluationProviderRegistry` resolves them lazily, so this module carries no
compile-time dependency on any feature.

`EvaluationRunnerService.run` is the whole lifecycle: open the run (concurrency
decided by the database), collect evidence, judge, compose coverage, persist the
immutable result, upsert findings, resolve absent findings, close the run. A
feature that implements the four ports inherits all of it.

## Scope

No controllers: HTTP endpoints, read models, notification templates and
scheduling belong to the feature. No `llm` dependency: deterministic judgments
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
