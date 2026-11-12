# Module: security-evaluation

The security feature on the evaluation skeleton (ADR-020), replacing the siloed
`dependency-scan` / `aws-audit` / `threat-intelligence` reports one mechanism at
a time (ADR-022). The legacy modules keep running unchanged; this module adds a
parallel, asset-centred track and never reads or writes their tables.

Shipped slices: **assets + DEPENDENCY** and **AWS_CONFIG** (ADR-027). INTEL
lands in a later slice on the same run and finding lifecycle.

## Vocabulary

| Term           | Meaning                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject        | The skeleton's `EvaluationSubject` row. `kind` is `repository` or `aws-account`; the coordinate is the module's `platform` constant (ADR-039) — projects are provenance, not scope. Subjects of kinds that need host credentials carry an opaque `credentialRef` registered at ingest.                                                         |
| Asset          | This module's `SecurityEvaluationAsset`, one-to-one with a subject. Owns `firstSeenAt` / `lastSeenAt` and the current-state knowledge items.                                                                                                                                                                                                   |
| Knowledge item | `SecurityEvaluationAwsConfigKnowledgeItem` / `SecurityEvaluationNpmPackageKnowledgeItem`: something observed about an asset right now (`type`, `key`, small intrinsic `value`); `SecurityEvaluationThreatKnowledgeItem` is the world-scoped intel sibling. Items are upserted, never deleted here; history lives in the archived run manifest. |
| Criteria       | Code-defined and published idempotently as `EvaluationRuleSetVersion` + `EvaluationCriterion` rows. A rule change is a new version, never an in-place edit.                                                                                                                                                                                    |
| Finding        | Skeleton `EvaluationFinding` with identity `(subjectId, evaluationKey, fingerprint)`. The fingerprint is version-free, so an upgrade onto another affected version keeps the same finding open.                                                                                                                                                |
| Urgency        | Derived band P1–P4 from severity and exposure. Not a stored score and not a composite.                                                                                                                                                                                                                                                         |

## Subject kinds and scopes

- `repository` — evidence is the repository's `package-lock.json`.
- `aws-account` — evidence is the account's configuration knowledge, collected
  through the host-bound `AwsConfigAccess` port. Nightwatch maps one
  configured `awsCrossAccountBinding` to one subject and registers the
  binding's credential reference (`aws-binding:<id>`) on the subject at ingest;
  evidence collection resolves exactly that reference, never a derived one.

Hosts declare subjects by calling `POST /security-evaluation/subjects/sync` with
one subject and the source that supplied it (`sourceType` / `sourceId`, opaque
strings). Kinds whose evaluation needs host credentials (today: `aws-account`)
also carry a `credentialRef` — an opaque pointer the module stores verbatim and
threads to the evidence port; it is captured at this registration point so
collection never rediscovers credentials through provenance. The module upserts
the platform-level subject, materialises its asset
and records a `SecurityEvaluationAssetSource` row; a second project referencing
the same repository adds provenance instead of a second subject. Ingest is
upsert-only: a subject that disappears from the host is not deleted, because
removal semantics are still an open decision (ADR-022).

Reads are platform-wide. The optional `scopeType` / `scopeId` query pair filters
by provenance (e.g. "only what project X submitted") and never authorizes
anything — access is the system-level permission grant (ADR-039 D3).

## Knowledge types

| `type`                            | `key`                     | `value`                                                                                                                   |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm.package`                     | `npm:<name>@<version>`    | `{ version, isDev, ecosystem }`                                                                                           |
| `aws.iam.account-password-policy` | `account-password-policy` | `{ exists, minimumPasswordLength, maxPasswordAgeDays, expirePasswords }`                                                  |
| `aws.iam.root-credential`         | `root`                    | `{ passwordEnabled, mfaActive, activeAccessKeyCount }`                                                                    |
| `aws.iam.user-credential`         | `<userName>`              | `{ userName, passwordEnabled, mfaActive }`                                                                                |
| `aws.s3.bucket-security`          | `<bucketName>`            | `{ bucketName, region, publicAccessBlock \| null, policyIsPublic, aclPublic, encryptionEnabled }`                         |
| `aws.rds.instance-security`       | `<identifier>`            | `{ identifier, region, publiclyAccessible, storageEncrypted }`                                                            |
| `aws.ec2.security-group-ingress`  | `<groupId>`               | `{ groupId, region, publicIngress: [{ protocol, fromPort, toPort, cidr }] }` (internet-open rules only; empty means none) |

## Evaluation keys

| Evaluation key | Kind          | Version | Content                                                                                        |
| -------------- | ------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `npm-osv`      | `repository`  | `v1`    | One ASSERTION criterion: installed npm packages matched against OSV.                           |
| `aws-cis-1.5`  | `aws-account` | `v1`    | Ten ASSERTION criteria of the CIS AWS Foundations Benchmark v1.5 initial set (ADR-027).        |
| `aws-custom`   | `aws-account` | `v1`    | Custom hardening criteria inherited from the predecessor aws-audit module (ADR-033/037).       |
| `threat-intel` | `repository`  | `v1`    | Threat-intelligence relevance criteria (ADR-039).                                              |
| `code-scan`    | `repository`  | `v1`    | Five ASSERTION risk-category criteria; every source file judged by an LLM full scan (ADR-054). |

Each CIS criterion carries `controlId`, `severity`, `remediation` and
`knowledgeRequirements` in its metadata; the judgment reads severity from there, and
the seed and the rulebook draw from one source. A rule change ships as a new
version of the evaluationKey, never an in-place edit.

## Port bindings

The module implements the skeleton's kind-scoped ports for both kinds:

- `EVALUATION_CRITERIA:{repository|aws-account}` → `SecurityEvaluationCriteriaProvider`
- `EVALUATION_EVIDENCE:repository` → `SecurityEvaluationEvidenceProvider`
- `EVALUATION_EVIDENCE:aws-account` → `SecurityEvaluationAwsConfigEvidenceProvider`
- `EVALUATION_JUDGMENT:{repository|aws-account}` → `SecurityEvaluationJudgmentService`
  (looks up the mechanisms declared for `ruleSetVersion.evaluationKey` in the
  registry: `npm-osv` → `dependency`, `aws-cis-1.5` / `aws-custom` → `aws-config`,
  `threat-intel` → `intel`, `code-scan` → `code-llm`, then merges their
  judgments, ADR-046)

The host must bind four more ports, owned by this module:

```ts
{ provide: securityEvaluationRepositoryAccessToken, useClass: YourRepositoryAccess }
{ provide: securityEvaluationRepositorySnapshotAccessToken, useClass: YourRepositorySnapshotAccess }
{ provide: securityEvaluationAwsConfigAccessToken, useClass: YourAwsConfigAccess }
{ provide: SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER, useClass: YourScopeEntitiesProvider }
```

`SecurityEvaluationScopeEntitiesProvider` (ADR-058) answers one question: which
business entities belong to _this_ subject? `null` means the host does not know
the subject and the run fails closed; `[]` means the host knows it but has
nothing to match, which short-circuits to an empty collection. The port is
optional at wiring time, but a `threat-intel` run without it fails with a
stable error instead of judging an empty profile.

`RepositorySnapshotAccess` (ADR-054) pins a whole run to one revision:
`list(subject, selection)` returns the scannable file entries plus the files
it cut (binary, over budget) with reasons, and `read(subject, revision, paths)`
resolves contents at exactly that revision. An unbound port, a listing
failure, or an empty scan set fails the run instead of reporting a vacuous
clean result.

`RepositoryAccess.getFile(subject, path)` returns a file at the repository root
or `null`. `AwsConfigAccess.collect(subject)` returns raw
configuration knowledge items plus per-type failures — never judged conclusions —
and resolves its credentials from `subject.credentialRef` directly. A subject
of kind `aws-account` without a registered credential reference is unevaluable:
the module fails the run with a stable error instead of attempting collection.
Nightwatch implements them with its `github` and `aws-identity` modules. An
unbound port is a wiring error: the run fails instead of reporting a vacuously
clean result.

## Coverage buckets

Every run records the skeleton's three buckets:

- `evaluated` — evidence items the judgment actually examined.
- `declaredUnlinked` — dependencies declared in `package.json` but absent from
  the lockfile. The aws-account mechanism has no such concept and always
  reports an empty bucket.
- `skipped` — packages whose OSV batch query failed, or cloud criteria whose
  knowledge could not be collected. Cloud entries name the control
  (`cis-1-13`) or the specific resource (`cis-2-1-1:<bucket>`). Skipped always
  carries a note and the item ids, never just a number.

Dependency evidence reads `package-lock.json` (lockfileVersion 2+) or a yarn
classic (`yarn.lock`, v1) lockfile, in that order. yarn records no dev flag, so
its development-only marking comes from `package.json`: a name declared in
`devDependencies` alone is development-only, while a transitive dev dependency
stays production — that overstates exposure instead of hiding it.

An unreadable lockfile, an unsupported lockfile format, a lockfile resolving
zero packages, or a cloud account whose knowledge all failed to collect fails the
run. An empty evaluated set must never surface as a clean result.

The report adds one asset-level bucket beside the per-result buckets:

- `unevaluable` — assets whose subject kind requires a registered credential
  reference (`aws-account`) and none is stored, so no run over them can collect
  evidence at all. Surfacing them separately keeps an un-integrated subject
  from reading as coverage.

## Scheduling

The module declares but never registers schedules; the host owns cron and
trigger conditions:

```ts
SECURITY_EVALUATION_SCHEDULES = [
  { evaluationKey: "npm-osv", subjectKind: "repository", recommendedInterval: "daily" },
  { evaluationKey: "aws-cis-1.5", subjectKind: "aws-account", recommendedInterval: "daily" },
  { evaluationKey: "aws-custom", subjectKind: "aws-account", recommendedInterval: "daily" },
  { evaluationKey: "threat-intel", subjectKind: "repository", recommendedInterval: "hourly" },
  { evaluationKey: "code-scan", subjectKind: "repository", recommendedInterval: "daily" },
];
```

## CODE_SCAN (ADR-054)

`code-scan` judges every source file of the repository snapshot with one LLM
call per file against five risk-category ASSERTION criteria
(`code-scan.injection`, `code-scan.auth-boundary`, `code-scan.secret-exposure`,
`code-scan.crypto-misuse`, `code-scan.dangerous-config`). It never auto-fires:
a repository subject stays on `npm-osv` unless the run carries
`config.evaluationKey: "code-scan"` (or the host schedules it explicitly).

Judgment identity and caching:

- A finding's fingerprint is `sha256("code-scan" + criterionKey + path +
symbol)` — no content hash, no line numbers (those live in finding
  metadata), so editing the vulnerable code keeps the finding's identity and
  any human suppression intact.
- Verdicts are cached bipolar (positive AND negative) in
  `SecurityEvaluationCodeScanVerdictCache`, keyed by `(subjectId,
criterionKey, path, contentHash, modelId, promptVersion, ruleSetVersion)`;
  an unchanged file replays its cached verdict and never re-calls the model.
  `unavailable` verdicts are never cached. Rows expire after the declared
  `codeScanVerdictCacheTtlDays` (`SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS`, no
  fallback) so long-unchanged files are re-judged against model drift, and the
  TTL is enforced physically: `SecurityEvaluationRetentionService.pruneExpired()`
  deletes expired rows instead of leaving them as permanent read-side misses
  (the host schedules that call, next to the daily scan).
- The LLM connection binds to the `security-evaluation-code-scan` scope.
  Without a bound model every file lands in the run's skipped bucket and no
  verdict is cached; the run still succeeds.
- The system prompt wraps source as untrusted data and forbids following
  directives inside the file; entries with an unknown criterion or an
  evidenceRef outside the judged file are discarded and accounted.

## Endpoints

| Method | Path                                                   | Purpose                                                                                             |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| POST   | `/security-evaluation/subjects/sync`                   | Ingest one subject with its provenance source (idempotent).                                         |
| GET    | `/security-evaluation/assets`                          | Asset inventory, platform-wide or provenance-filtered.                                              |
| GET    | `/security-evaluation/assets/:assetId/knowledge-items` | Current-state knowledge items of one asset.                                                         |
| POST   | `/security-evaluation/runs`                            | Dispatch a run: 202 once admitted (`fire-and-forget`); admission answers 400/404/409 synchronously. |
| GET    | `/security-evaluation/runs`                            | Run history, platform-wide or provenance/subject-filtered.                                          |
| GET    | `/security-evaluation/results`                         | Archived results (manifest excluded).                                                               |
| GET    | `/security-evaluation/findings`                        | Findings with evaluationKey / status / severity filters (platform-wide or provenance-filtered).     |
| GET    | `/security-evaluation/report`                          | Single-axis report: assets, coverage, findings, trend, MTTR (platform-wide or provenance-filtered). |

## Limitations

- Only `package-lock.json` with lockfileVersion 2+ is parsed; `package.json`
  ranges cannot be matched against vulnerability ranges.
- Severity comes from OSV `database_specific.severity` free text; CVSS vectors
  are not interpreted, and a record without severity is reported as INFO with
  `severitySource: "unknown"`.
- Data source is osv.dev; an OSV outage degrades coverage (skipped packages), it
  does not silently pass.
- The CIS catalog covers the initial ten controls only; catalog growth is a new
  evaluationKey version. Cloud findings carry exposure `internal` until a reachability
  signal exists, so urgency derives no relief.
- The report has no composite score and no cross-evaluationKey weighting (ADR-020 D5.3,
  ADR-022 D6). A second axis is a later milestone, not a field to sneak in.
- CODE_SCAN judgment is per file: there is no cross-file dataflow analysis, so
  a vulnerability whose source and sink live in different files is out of
  reach (a v2 mechanism candidate, ADR-054).
- Files larger than the excerpt budget are judged on their truncated prefix
  and flagged `truncated` in the evidence payload; the verdict cache key still
  hashes the full content. The excerpt itself is never written into the
  immutable result manifest: it lives in
  `SecurityEvaluationCodeScanFileExcerpt`, content-addressed by
  `(subjectId, contentHash)`, and `pruneExpired()` physically deletes rows
  after `SECURITY_EVALUATION_CODE_SCAN_EXCERPT_RETENTION_DAYS` (90). Reads
  apply the same window, so a row that outlives a prune cycle is never
  re-attached; the finding detail then falls back to `contentHash` +
  `truncated` (ADR-054 D7).
- CODE_SCAN sends (truncated) source code to the configured LLM provider —
  including any secrets committed to the repository. That exposure is an
  accepted trade-off of v1; the `code-scan.secret-exposure` findings it
  produces are the detection side of it.
