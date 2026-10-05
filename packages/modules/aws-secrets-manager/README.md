# AWS Secrets Manager Module

A stateless read-through proxy over AWS Secrets Manager. AWS is the single source of truth for all secret data — this module keeps **no local database mirror** of secret metadata.

## Design

- **Read-through proxy**: every endpoint resolves the project's AWS credential (via the `aws-core` module) and calls AWS Secrets Manager directly. Project isolation comes from the credential itself — each project points at its own AWS account.
- **Tag-based contract**: managed secrets carry two tags, written atomically at creation time:
  - `nightwatch:managed=true` — marks the secret as visible to this management plane
  - `nightwatch:secret-type=<TYPE>` — one of `RDS_CREDENTIALS`, `DOCUMENTDB_CREDENTIALS`, `AWS_API_KEY`, `GENERIC_SECRET`; consumed by the rotation Lambda to pick a strategy
- **No infrastructure deployment in the API process**: the rotation Lambda is deployed by the `newbie env setup` CLI command, which prints the Lambda ARN to paste into Project Settings (`awsSecretsManagerRotationLambdaArn`).

## API Endpoints

All routes live under `/aws-secrets-manager/secrets` and are keyed by secret **name** (there is no local id). Every endpoint requires a `projectId` (query or body) to resolve the AWS credential; an optional `region` overrides the credential default region.

| Method | Path                                          | Purpose                                               |
| ------ | --------------------------------------------- | ----------------------------------------------------- |
| POST   | `/aws-secrets-manager/secrets`                | Create a secret (value + tags in one atomic call)     |
| GET    | `/aws-secrets-manager/secrets`                | List managed secrets (one cursor page, metadata only) |
| GET    | `/aws-secrets-manager/secrets/:name`          | Secret metadata                                       |
| GET    | `/aws-secrets-manager/secrets/:name/value`    | Decrypted secret value (AWSCURRENT)                   |
| PATCH  | `/aws-secrets-manager/secrets/:name`          | Update value / description / type                     |
| DELETE | `/aws-secrets-manager/secrets/:name`          | Delete with a 30-day recovery window                  |
| POST   | `/aws-secrets-manager/secrets/:name/rotate`   | Trigger an immediate rotation                         |
| POST   | `/aws-secrets-manager/secrets/:name/rotation` | Enable / disable automatic rotation                   |

Secret names must match `^[a-zA-Z0-9_+=.@-]{1,512}$` (no slash — the name is a URL path parameter).

## Pagination

The list endpoint uses AWS-native cursor pagination (there is no total count — AWS cannot return one without a full scan):

- Request: optional `pageSize` (1–100, default 100) and `nextToken`.
- Response: `{ records, nextToken }`; `nextToken` is `null` on the last page, otherwise pass it back unchanged to fetch the next page.

## Secret values

The write path (create / update) accepts `secretValue` as either:

- a JSON object — stored as a JSON document, or
- a non-empty plain-text string — stored verbatim.

The value endpoint returns `{ name, secretValue, valueType }` where `valueType` is:

- `json` — `SecretString` parsed into an object;
- `text` — `SecretString` returned verbatim (plain text, or a non-object JSON document such as an array or scalar);
- `binary` — externally provisioned `SecretBinary`, re-encoded as base64 (binary values cannot be created from this plane).

## Audit trail

All sensitive operations write business audit rows through the audit module's `AuditLogService` (`resourceType: "secret"`, `resourceId` = secret name, with actor / IP / user agent):

| Event                        | Trigger                             |
| ---------------------------- | ----------------------------------- |
| `secret.value_read`          | GET value (success and failure)     |
| `secret.created`             | create secret                       |
| `secret.updated`             | update value / description / type   |
| `secret.deleted`             | delete secret                       |
| `secret.rotated`             | immediate rotation                  |
| `secret.rotation_configured` | enable / disable automatic rotation |

The five mutating routes carry `@SkipHttpAudit()` so they are not double-recorded by the generic HTTP interceptor (which cannot resolve the `:name` path parameter as a resource id). Detail payloads contain only projectId, region, type, changed field **names**, enabled/days, `valueType`, or a failure `reason`/`statusCode` — **never secret values or raw AWS error messages**. List and metadata reads are not audited.

## Rotation

- Enabling rotation calls `RotateSecret` with the Lambda ARN from Project Settings and a day interval (default 30); AWS both configures the schedule and starts the first rotation.
- Disabling calls `CancelRotateSecret`, which turns off automatic rotation and cancels any in-progress one.
- The rotation Lambda source lives in the `newbie` CLI package (deployed via `newbie env setup`) and routes strategies by reading the `nightwatch:secret-type` tag via `DescribeSecret`.

## Error mapping

AWS SDK errors are mapped without leaking raw AWS messages: `ResourceNotFoundException` → 404, `ResourceExistsException` → 409, `InvalidParameter/InvalidRequest/Validation` → 400, everything else → 502.
