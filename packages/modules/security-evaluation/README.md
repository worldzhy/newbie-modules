# Module: security-evaluation

The security feature on the evaluation skeleton (ADR-020), replacing the siloed
`dependency-scan` / `aws-audit` / `threat-intelligence` reports one mechanism at
a time (ADR-022). The legacy modules keep running unchanged; this module adds a
parallel, subject-centred track and never reads or writes their tables.

Shipped slices: **subjects + DEPENDENCY** and **AWS_CONFIG** (ADR-027). INTEL
lands in a later slice on the same run and finding lifecycle.

## Vocabulary

| Term           | Meaning                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject        | The skeleton's `EvaluationSubject` row and this feature's only identity. `kind` is `repository`, `aws-account` or `web-origin`; the coordinate is `(subjectType, kind, subjectKey)` with `subjectType = "security-evaluation"` (ADR-068, ADR-069). Subjects of kinds that need host credentials carry an opaque `credentialRef` registered at ingest. Provenance lives in the host, not here. |
| Web origin     | `SecurityEvaluationWebOrigin`, one-to-one with a web-origin subject. Owns the `targetPaths` role map and the ownership-verification lifecycle (token, method, status, timestamps). Identity stays on the subject (`subjectKey` = normalized origin, `displayName` = label).                                                                                                                   |
| Repository     | `SecurityEvaluationRepository`, one-to-one with a repository subject: the evaluation-side copy of the coordinate (`provider`, `namespace`, `name`, `url`). Natural key `provider:namespace/name` (lowercased); the host's own repository record stays the host's truth (ADR-070 D1, D2).                                                                                                      |
| AWS account    | `SecurityEvaluationAwsAccount`, one-to-one with an aws-account subject: `accountId` (the natural key, 12 digits), `defaultRegion`, `regions`. Credentials stay a host concern and live on the subject's `credentialRef` (ADR-070 D1, D2).                                                                                                                                                     |
| Knowledge item | `SecurityEvaluationAwsConfigKnowledgeItem` / `SecurityEvaluationNpmPackageKnowledgeItem`: something observed about a subject right now (`type`, `key`, small intrinsic `value`); `SecurityEvaluationThreatKnowledgeItem` is the world-scoped intel sibling. Items are upserted, never deleted here; history lives in the archived run manifest.                                               |
| Criteria       | Code-defined and published idempotently as `EvaluationRuleSetVersion` + `EvaluationCriterion` rows. A rule change is a new version, never an in-place edit.                                                                                                                                                                                                                                   |
| Finding        | Skeleton `EvaluationFinding` with identity `(subjectId, standardKey, fingerprint)`. The fingerprint is version-free, so an upgrade onto another affected version keeps the same finding open.                                                                                                                                                                                                 |
| Urgency        | Derived band P1–P4 from severity and exposure. Not a stored score and not a composite.                                                                                                                                                                                                                                                                                                        |

## Subject kinds and scopes

- `repository` — evidence is the repository's `package-lock.json`. Identity is
  the natural coordinate `provider:namespace/name` (GitHub owner / Bitbucket
  workspace both map to `namespace`, all lowercase); a monorepo is one subject
  no matter how many applications point at it.
- `aws-account` — evidence is the account's configuration knowledge, collected
  through the host-bound `AwsConfigAccess` port. The 12-digit account id is the
  subject key, so a binding can be recreated without orphaning history.
  Nightwatch registers the binding's credential reference
  (`aws-binding:<id>`) on the subject at ingest; evidence collection resolves
  exactly that reference, never a derived one.
- `web-origin` — a deployment registered by `SecurityEvaluationWebOriginService`.
  `create` writes the platform subject and the web-origin record in one
  transaction; `origin` is normalized to `scheme://host[:port]` (lowercase,
  punycode, default ports omitted) and becomes the subject's `subjectKey`.
  Evaluation is gated on ownership verification: only `isActive` and `VERIFIED`
  origins are submitted, and `listActiveVerified` lazily re-verifies them after
  the configured interval (ADR-044). Verification reads go through the optional
  host-bound `SECURITY_EVALUATION_VERIFICATION_FETCH_ACCESS` port.

Hosts declare subjects by calling `POST /security-evaluation/subjects/sync` with
one subject (`kind`, `displayName`). `repository` submissions carry their
coordinate (`repository: { provider, namespace, name, url? }`) and
`aws-account` submissions their `awsAccount: { accountId, defaultRegion?,
regions? }`; the module normalizes it, derives the subject key and upserts the
material row in the same transaction — a host id is never submitted. Other kinds
pass `subjectKey` directly. Kinds whose evaluation needs host credentials
(today: `aws-account`) also carry a `credentialRef` — an opaque pointer the
module stores verbatim and threads to the evidence port; it is captured at this
registration point so collection never rediscovers credentials.
The module upserts the platform-level subject; a second project referencing the
same repository reuses the same subject, run history and findings. Ingest is
upsert-only; retiring a material row is not designed (ADR-070 D5).

Reads are platform-wide with an optional `subjectId` filter. There is no
provenance coordinate and no scope filter (ADR-068 D8) — access is the
system-level permission grant (ADR-039 D3).

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

| Evaluation key | Kind          | Version | Content                                                                                         |
| -------------- | ------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `npm-osv`      | `repository`  | `v1`    | One ASSERTION criterion: installed npm packages matched against OSV.                            |
| `aws-cis-1.5`  | `aws-account` | `v1`    | Ten ASSERTION criteria of the CIS AWS Foundations Benchmark v1.5 initial set (ADR-027).         |
| `aws-custom`   | `aws-account` | `v1`    | Custom hardening criteria inherited from the predecessor aws-audit module (ADR-033/037).        |
| `threat-intel` | `repository`  | `v1`    | Threat-intelligence relevance criteria (ADR-039).                                               |
| `code-scan`    | `repository`  | `v1`    | Five ASSERTION risk-category criteria; every source file judged by an LLM full scan (ADR-054).  |
| `web-posture`  | `web-origin`  | `v1`    | Eleven ASSERTION criteria over HTTP security headers and TLS protocol/cipher posture (ADR-066). |

Each CIS criterion carries `controlId`, `severity`, `remediation` and
`knowledgeRequirements` in its metadata; the judgment reads severity from there, and
the seed and the rulebook draw from one source. A rule change ships as a new
version of the standardKey, never an in-place edit.

## Port bindings

The module implements the skeleton's kind-scoped ports for both kinds:

- `EVALUATION_CRITERIA:{repository|aws-account}` → `SecurityEvaluationCriteriaProvider`
- `EVALUATION_EVIDENCE:repository` → `SecurityEvaluationEvidenceProvider`
- `EVALUATION_EVIDENCE:aws-account` → `SecurityEvaluationAwsConfigEvidenceProvider`
- `EVALUATION_EVIDENCE:web-origin` → `SecurityEvaluationWebPostureEvidenceProvider`
- `EVALUATION_JUDGMENT:{repository|aws-account|web-origin}` → `SecurityEvaluationJudgmentService`
  (looks up the mechanisms declared for `ruleSetVersion.standardKey` in the
  registry: `npm-osv` → `dependency`, `aws-cis-1.5` / `aws-custom` → `aws-config`,
  `threat-intel` → `intel`, `code-scan` → `code-llm`, `web-posture` →
  `web-posture`, then merges their judgments, ADR-046)

The host must bind five more ports, owned by this module:

```ts
{ provide: securityEvaluationRepositoryAccessToken, useClass: YourRepositoryAccess }
{ provide: securityEvaluationRepositorySnapshotAccessToken, useClass: YourRepositorySnapshotAccess }
{ provide: securityEvaluationAwsConfigAccessToken, useClass: YourAwsConfigAccess }
{ provide: SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER, useClass: YourScopeEntitiesProvider }
{ provide: SECURITY_EVALUATION_WEB_PROBE_ACCESS, useClass: YourWebProbeAccess }
```

The last one is required only by deployments that evaluate `web-origin`
subjects; a `web-posture` run without it fails with a wiring error.

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

The report adds one subject-level bucket beside the per-result buckets:

- `unevaluable` — subjects whose kind requires a registered credential
  reference (`aws-account`) and none is stored, so no run over them can collect
  evidence at all. Surfacing them separately keeps an un-integrated subject
  from reading as coverage.

## Scheduling

The module declares but never registers schedules; the host owns cron and
trigger conditions:

```ts
SECURITY_EVALUATION_SCHEDULES = [
  { standardKey: "npm-osv", subjectKind: "repository", recommendedInterval: "daily" },
  { standardKey: "aws-cis-1.5", subjectKind: "aws-account", recommendedInterval: "daily" },
  { standardKey: "aws-custom", subjectKind: "aws-account", recommendedInterval: "daily" },
  { standardKey: "threat-intel", subjectKind: "repository", recommendedInterval: "hourly" },
  { standardKey: "code-scan", subjectKind: "repository", recommendedInterval: "daily" },
  { standardKey: "web-posture", subjectKind: "web-origin", recommendedInterval: "daily" },
];
```

## WEB_POSTURE (ADR-066)

`web-posture` judges an owned web origin from the outside: one HTML request, an
optional `api.session` request, and one TLS handshake. It never authenticates,
never follows a browser flow, and never sends a request that triggers an
outbound email or OTP.

The host must bind `SECURITY_EVALUATION_WEB_PROBE_ACCESS`; without it the run
fails with a wiring error instead of reporting a clean result. A missing
`api.session` path role skips only the two API header criteria and is reported
in the coverage bucket. Findings are fingerprinted as
`sha256(criterionKey + "\u0000" + discriminator)` where the discriminator is the
header name with its role, the legacy TLS protocol, or the weak cipher suite.

## CODE_SCAN (ADR-054)

`code-scan` judges every source file of the repository snapshot with one LLM
call per file against five risk-category ASSERTION criteria
(`code-scan.injection`, `code-scan.auth-boundary`, `code-scan.secret-exposure`,
`code-scan.crypto-misuse`, `code-scan.dangerous-config`). It never auto-fires:
a repository subject stays on `npm-osv` unless the run carries
`judgmentConfig.standardKey: "code-scan"` (or the host schedules it explicitly).

Judgment identity and caching:

- A finding's fingerprint is `sha256("code-scan" + criterionKey + path +
symbol)` — no content hash, no line numbers (those live in finding
  metadata), so editing the vulnerable code keeps the finding's identity and
  any human suppression intact.
- Verdicts are cached bipolar (positive AND negative) in
  `SecurityEvaluationCodeScanVerdictCache`, keyed by `(subjectId,
criterionKey, path, contentHash, modelId, promptVersion, ruleSetVersion)`;
  an unchanged file replays its cached verdict and never re-calls the model.
  `unavailable` verdicts are never cached. Rows expire after the module
  constant `SECURITY_EVALUATION_CODE_SCAN_VERDICT_CACHE_TTL_DAYS` (30, ADR-053:
  a policy value, identical in every deployment) so long-unchanged files are
  re-judged against model drift, and the TTL is enforced physically: `SecurityEvaluationRetentionService.pruneExpired()`
  deletes expired rows instead of leaving them as permanent read-side misses
  (the host schedules that call, next to the daily scan).
- The LLM connection binds to the `security-evaluation-code-scan` scope.
  Without a bound model every file lands in the run's skipped bucket and no
  verdict is cached; the run still succeeds.
- The system prompt wraps source as untrusted data and forbids following
  directives inside the file; entries with an unknown criterion or an
  evidenceRef outside the judged file are discarded and accounted.

## Endpoints

| Method | Path                                                       | Purpose                                                                                                     |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| POST   | `/security-evaluation/subjects/sync`                       | Ingest one platform-level subject plus its material row (idempotent per `(subjectType, kind, subjectKey)`). |
| GET    | `/security-evaluation/subjects`                            | Subject directory, optionally filtered by kind.                                                             |
| GET    | `/security-evaluation/subjects/:subjectId/knowledge-items` | Current-state knowledge items of one subject.                                                               |
| POST   | `/security-evaluation/runs`                                | Dispatch a run: 202 once admitted (`fire-and-forget`); admission answers 400/404/409 synchronously.         |
| GET    | `/security-evaluation/runs`                                | Run history, platform-wide or subject-filtered.                                                             |
| GET    | `/security-evaluation/results`                             | Archived results (manifest excluded).                                                                       |
| GET    | `/security-evaluation/findings`                            | Findings with standardKey / status / severity filters (platform-wide or subject-filtered).                  |
| GET    | `/security-evaluation/report`                              | Single-axis report: subjects, coverage, findings, trend, MTTR (platform-wide or subject-filtered).          |

## Limitations

- Only `package-lock.json` with lockfileVersion 2+ is parsed; `package.json`
  ranges cannot be matched against vulnerability ranges.
- Severity comes from OSV `database_specific.severity` free text; CVSS vectors
  are not interpreted, and a record without severity is reported as INFO with
  `severitySource: "unknown"`.
- Data source is osv.dev; an OSV outage degrades coverage (skipped packages), it
  does not silently pass.
- The CIS catalog covers the initial ten controls only; catalog growth is a new
  standardKey version. Cloud findings carry exposure `internal` until a reachability
  signal exists, so urgency derives no relief.
- The report has no composite score and no cross-standardKey weighting (ADR-020 D5.3,
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
