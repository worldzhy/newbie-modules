# Module: security-evaluation

The security feature on the evaluation skeleton (ADR-020), replacing the siloed
`dependency-scan` / `aws-audit` / `threat-intelligence` reports one mechanism at
a time (ADR-022). The legacy modules keep running unchanged; this module adds a
parallel, asset-centred track and never reads or writes their tables.

Shipped slice: **assets + DEPENDENCY**. CLOUD_CONFIG and INTEL land in later
slices on the same run and finding lifecycle.

## Vocabulary

| Term     | Meaning                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject  | The skeleton's `EvaluationSubject` row. `kind` is `repository` or `cloud-account`; `scopeType` / `scopeId` are host-assigned (nightwatch uses `project`).                                                        |
| Asset    | This module's `SecurityEvaluationAsset`, one-to-one with a subject. Owns `firstSeenAt` / `lastSeenAt` and the current-state facts.                                                                               |
| Fact     | `SecurityEvaluationAssetFact`: something observed about an asset right now (`factType`, `factKey`, small intrinsic `value`). Facts are upserted, never deleted here; history lives in the archived run manifest. |
| Criteria | Code-defined and published idempotently as `EvaluationCriteriaVersion` + `EvaluationCriterion` rows. A rule change is a new version, never an in-place edit.                                                     |
| Finding  | Skeleton `EvaluationFinding` with identity `(subjectId, family, fingerprint)`. The fingerprint is version-free, so an upgrade onto another affected version keeps the same finding open.                         |
| Urgency  | Derived band P1–P4 from severity and exposure. Not a stored score and not a composite.                                                                                                                           |

## Subject kinds and scopes

- `repository` — evidence is the repository's `package-lock.json`.
- `cloud-account` — reserved for the CLOUD_CONFIG slice; no judgment is bound
  for it in this build, so `POST /security-evaluation/runs` rejects it.

Hosts declare subjects by calling `POST /security-evaluation/subjects/sync` with
a scope; the skeleton's `SubjectProvider` does the enumeration and every returned
subject is materialised as an asset. Sync is upsert-only: a subject that
disappears from the host is not deleted, because removal semantics are still an
open decision (ADR-022).

## Fact types

| `factType` | `factKey`              | `value`                         |
| ---------- | ---------------------- | ------------------------------- |
| `package`  | `npm:<name>@<version>` | `{ version, isDev, ecosystem }` |

## Port bindings

The module implements three of the skeleton's kind-scoped ports for
`repository`:

- `EVALUATION_CRITERIA:repository` → `SecurityEvaluationCriteriaProvider`
- `EVALUATION_EVIDENCE:repository` → `SecurityEvaluationEvidenceProvider`
- `EVALUATION_JUDGMENT:repository` → `SecurityEvaluationJudgmentService`
  (dispatches on `criteriaVersion.family`; `dependency-osv` today)

The host must bind one more port, owned by this module:

```ts
{ provide: securityEvaluationRepositoryAccessToken, useClass: YourRepositoryAccess }
```

`RepositoryAccess.getFile(subject, path)` returns a file at the repository root
or `null`. Nightwatch implements it with its `github` module. An unbound port is
a wiring error: the run fails instead of reporting a vacuously clean result.

## Coverage buckets

Every run records the skeleton's three buckets:

- `evaluated` — evidence items the judgment actually examined.
- `declaredUnlinked` — dependencies declared in `package.json` but absent from
  the lockfile. A declared dependency without an installed fact was not judged,
  and saying so beats counting it as clean.
- `skipped` — packages whose OSV batch query failed. Skipped always carries a
  note and the item ids, never just a number.

An unreadable lockfile, an unsupported lockfile format, or a lockfile resolving
zero packages fails the run. An empty evaluated set must never surface as a
clean result.

## Scheduling

The module declares but never registers schedules; the host owns cron and
trigger conditions:

```ts
SECURITY_EVALUATION_SCHEDULES = [
  { family: "dependency-osv", subjectKind: "repository", recommendedInterval: "daily" },
  { family: "cis-aws-1.5", subjectKind: "cloud-account", recommendedInterval: "daily" },
  { family: "threat-intel-relevance", subjectKind: "repository", recommendedInterval: "hourly" },
];
```

## Endpoints

| Method | Path                                         | Purpose                                                         |
| ------ | -------------------------------------------- | --------------------------------------------------------------- |
| POST   | `/security-evaluation/subjects/sync`         | Ask the host provider to sync subjects and assets (idempotent). |
| GET    | `/security-evaluation/assets`                | Asset inventory under a scope.                                  |
| GET    | `/security-evaluation/assets/:assetId/facts` | Current-state facts of one asset.                               |
| POST   | `/security-evaluation/runs`                  | Dispatch a run (202, fire-and-forget).                          |
| GET    | `/security-evaluation/runs`                  | Run history for a subject.                                      |
| GET    | `/security-evaluation/results`               | Archived results (manifest excluded).                           |
| GET    | `/security-evaluation/findings`              | Findings with family / status / severity filters.               |
| GET    | `/security-evaluation/report`                | Single-axis report: assets, coverage, findings, trend, MTTR.    |

## Limitations

- Only `package-lock.json` with lockfileVersion 2+ is parsed; `package.json`
  ranges cannot be matched against vulnerability ranges.
- Severity comes from OSV `database_specific.severity` free text; CVSS vectors
  are not interpreted, and a record without severity is reported as INFO with
  `severitySource: "unknown"`.
- Data source is osv.dev; an OSV outage degrades coverage (skipped packages), it
  does not silently pass.
- The report has no composite score and no cross-family weighting (ADR-020 D5.3,
  ADR-022 D6). A second axis is a later milestone, not a field to sneak in.
