# Module: security-evaluation

The security feature on the evaluation skeleton (ADR-020), replacing the siloed
`dependency-scan` / `aws-audit` / `threat-intelligence` reports one mechanism at
a time (ADR-022). The legacy modules keep running unchanged; this module adds a
parallel, asset-centred track and never reads or writes their tables.

Shipped slices: **assets + DEPENDENCY** and **CLOUD_CONFIG** (ADR-027). INTEL
lands in a later slice on the same run and finding lifecycle.

## Vocabulary

| Term     | Meaning                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject  | The skeleton's `EvaluationSubject` row. `kind` is `repository` or `aws-account`; `scopeType` / `scopeId` are host-assigned (nightwatch uses `project`).                                                        |
| Asset    | This module's `SecurityEvaluationAsset`, one-to-one with a subject. Owns `firstSeenAt` / `lastSeenAt` and the current-state facts.                                                                               |
| Fact     | `SecurityEvaluationAssetFact`: something observed about an asset right now (`factType`, `factKey`, small intrinsic `value`). Facts are upserted, never deleted here; history lives in the archived run manifest. |
| Criteria | Code-defined and published idempotently as `EvaluationCriteriaVersion` + `EvaluationCriterion` rows. A rule change is a new version, never an in-place edit.                                                     |
| Finding  | Skeleton `EvaluationFinding` with identity `(subjectId, evaluationKey, fingerprint)`. The fingerprint is version-free, so an upgrade onto another affected version keeps the same finding open.                  |
| Urgency  | Derived band P1–P4 from severity and exposure. Not a stored score and not a composite.                                                                                                                           |

## Subject kinds and scopes

- `repository` — evidence is the repository's `package-lock.json`.
- `aws-account` — evidence is the account's configuration facts, collected
  through the host-bound `CloudConfigurationAccess` port. Nightwatch maps one
  configured `awsCrossAccountBinding` to one subject.

Hosts declare subjects by calling `POST /security-evaluation/subjects/sync` with
a scope; the skeleton's `SubjectProvider` does the enumeration and every returned
subject is materialised as an asset. Sync is upsert-only: a subject that
disappears from the host is not deleted, because removal semantics are still an
open decision (ADR-022).

## Fact types

| `factType`                        | `factKey`                 | `value`                                                                                                                   |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `package`                         | `npm:<name>@<version>`    | `{ version, isDev, ecosystem }`                                                                                           |
| `aws.iam.account-password-policy` | `account-password-policy` | `{ exists, minimumPasswordLength, maxPasswordAgeDays, expirePasswords }`                                                  |
| `aws.iam.root-credential`         | `root`                    | `{ passwordEnabled, mfaActive, activeAccessKeyCount }`                                                                    |
| `aws.iam.user-credential`         | `<userName>`              | `{ userName, passwordEnabled, mfaActive }`                                                                                |
| `aws.s3.bucket-security`          | `<bucketName>`            | `{ bucketName, region, publicAccessBlock \| null, policyIsPublic, aclPublic, encryptionEnabled }`                         |
| `aws.rds.instance-security`       | `<identifier>`            | `{ identifier, region, publiclyAccessible, storageEncrypted }`                                                            |
| `aws.ec2.security-group-ingress`  | `<groupId>`               | `{ groupId, region, publicIngress: [{ protocol, fromPort, toPort, cidr }] }` (internet-open rules only; empty means none) |

## Evaluation keys

| Evaluation key   | Kind            | Version | Content                                                                                 |
| ---------------- | --------------- | ------- | --------------------------------------------------------------------------------------- |
| `npm-osv`        | `repository`    | `v1`    | One ASSERTION criterion: installed npm packages matched against OSV.                    |
| `aws-cis-1.5`    | `aws-account`   | `v1`    | Ten ASSERTION criteria of the CIS AWS Foundations Benchmark v1.5 initial set (ADR-027). |
| `aws-custom`     | `aws-account`   | `v1`    | Custom hardening criteria inherited from the predecessor aws-audit module (ADR-033/037). |
| `threat-intel`   | `repository`    | `v1`    | Threat-intelligence relevance criteria (ADR-039).                                       |

Each CIS criterion carries `controlId`, `severity`, `remediation` and
`factRequirements` in its metadata; the judgment reads severity from there, and
the seed and the rulebook draw from one source. A rule change ships as a new
version of the evaluationKey, never an in-place edit.

## Port bindings

The module implements the skeleton's kind-scoped ports for both kinds:

- `EVALUATION_CRITERIA:{repository|aws-account}` → `SecurityEvaluationCriteriaProvider`
- `EVALUATION_EVIDENCE:repository` → `SecurityEvaluationEvidenceProvider`
- `EVALUATION_EVIDENCE:aws-account` → `SecurityEvaluationCloudConfigEvidenceProvider`
- `EVALUATION_JUDGMENT:{repository|aws-account}` → `SecurityEvaluationJudgmentService`
  (dispatches on `criteriaVersion.evaluationKey`: `npm-osv`, `aws-cis-1.5`,
  `aws-custom`, `threat-intel`)

The host must bind two more ports, owned by this module:

```ts
{ provide: securityEvaluationRepositoryAccessToken, useClass: YourRepositoryAccess }
{ provide: securityEvaluationCloudConfigurationAccessToken, useClass: YourCloudConfigurationAccess }
```

`RepositoryAccess.getFile(subject, path)` returns a file at the repository root
or `null`. `CloudConfigurationAccess.collectFacts(subject)` returns raw
configuration facts plus per-fact-type failures — never judged conclusions.
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
  facts could not be collected. Cloud entries name the control
  (`cis-1-13`) or the specific resource (`cis-2-1-1:<bucket>`). Skipped always
  carries a note and the item ids, never just a number.

An unreadable lockfile, an unsupported lockfile format, a lockfile resolving
zero packages, or a cloud account whose facts all failed to collect fails the
run. An empty evaluated set must never surface as a clean result.

## Scheduling

The module declares but never registers schedules; the host owns cron and
trigger conditions:

```ts
SECURITY_EVALUATION_SCHEDULES = [
  { evaluationKey: "npm-osv", subjectKind: "repository", recommendedInterval: "daily" },
  { evaluationKey: "aws-cis-1.5", subjectKind: "aws-account", recommendedInterval: "daily" },
  { evaluationKey: "aws-custom", subjectKind: "aws-account", recommendedInterval: "daily" },
  { evaluationKey: "threat-intel", subjectKind: "repository", recommendedInterval: "hourly" },
];
```

## Endpoints

| Method | Path                                         | Purpose                                                                                             |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/security-evaluation/subjects/sync`         | Ask the host provider to sync subjects and assets (idempotent).                                     |
| GET    | `/security-evaluation/assets`                | Asset inventory under a scope.                                                                      |
| GET    | `/security-evaluation/assets/:assetId/facts` | Current-state facts of one asset.                                                                   |
| POST   | `/security-evaluation/runs`                  | Dispatch a run: 202 once admitted (`fire-and-forget`); admission answers 400/404/409 synchronously. |
| GET    | `/security-evaluation/runs`                  | Run history for a subject.                                                                          |
| GET    | `/security-evaluation/results`               | Archived results (manifest excluded).                                                               |
| GET    | `/security-evaluation/findings`              | Findings with evaluationKey / status / severity filters.                                            |
| GET    | `/security-evaluation/report`                | Single-axis report: assets, coverage, findings, trend, MTTR.                                        |

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
