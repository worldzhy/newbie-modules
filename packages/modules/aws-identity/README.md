# newbie.aws-identity

Single AWS identity exit point for a host application. The module brokers
two distinct identity planes:

- **Default plane (host-owned resources)**: the host's own AWS identity,
  resolved lazily through the SDK default credential chain
  (`AWS_*` env vars, SSO, shared config, ECS/IRSA web identity, EC2 instance
  profile). `resolveDefaultCredentials()` returns the shared memoized
  provider; default-plane resource modules (aws-s3, aws-ses, aws-sms) build
  their clients with it. Rotation is automatic (SSO refresh tokens, instance
  profile / IRSA credential rotation); no long-lived key is stored.
- **Cross-account plane (customer resources)**: customers create a
  customer-managed IAM role in their own account and allow the host default
  account to assume it via STS AssumeRole with a per-binding external ID
  (confused-deputy protection). `resolveProjectCredential(projectId)`
  exchanges and caches short-lived sessions for consumers (aws-audit,
  aws-secrets-manager, aws-cloudwatch).

## Storage

`AwsCrossAccountBinding` lives in the module-owned schema
`module/aws-identity`. `projectId` is a plain unique host-scope column
(UUID) without a foreign key or a Prisma relation: the module never reads
host tables and can be assembled into any host application. One binding row
per host scope; a row may briefly exist with a null `roleArn` after
bootstrap (external ID generated, role ARN not saved yet).

Typical setup flow: bootstrap (external ID generated) -> customer pastes
the external ID into the role trust policy -> save role ARN (verified with
a live AssumeRole before persisting) -> use verify / rotate-external-id /
delete.

## HTTP surface

All routes are scoped by host scope id; request/response shape is stable
across host applications:

```
GET    /aws-credentials/projects/:projectId
POST   /aws-credentials/projects/:projectId/bootstrap
PUT    /aws-credentials/projects/:projectId
POST   /aws-credentials/projects/:projectId/verify
POST   /aws-credentials/projects/:projectId/rotate-external-id
DELETE /aws-credentials/projects/:projectId
```
