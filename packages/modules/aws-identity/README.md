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
  account to assume it via STS AssumeRole with an external ID
  (confused-deputy protection). `resolveProjectCredential(consumerId)`
  exchanges and caches short-lived sessions for consumers (aws-audit,
  aws-secrets-manager, aws-cloudwatch).

## Storage

Two models live in the module-owned schema `module/aws-identity`.

`AwsCrossAccountBinding` is scoped by the customer AWS account id
(`accountId`, unique): an IAM role, its trust policy, the region list and the
rotation Lambda are account-level resources, so one row describes the
platform's access relationship with one customer account. `externalId`
belongs to the identity currently assumed, `pendingExternalId` (nullable)
belongs to a candidate that has not been verified yet. The active identity
keeps serving while a replacement is being prepared, and the old external ID
retires with the old role so its trust policy no longer matches. A row may
briefly exist with a null `roleArn` after bootstrap (external ID generated,
role ARN not saved yet).

`AwsCrossAccountBindingUsage` records which host consumer references which
account binding. `consumerId` is a plain unique column (project id / tenant
id / organization id) without a foreign key or a Prisma relation: the module
never reads host tables and can be assembled into any host application. A
missing usage row simply means "this consumer has not attached an AWS
account". Deleting a binding while usages exist is refused.

Typical setup flow: bootstrap the account (external ID generated) -> customer
pastes the external ID into the role trust policy -> save role ARN (verified
with a live AssumeRole before persisting, and rejected when the assumed
account does not match `accountId`) -> attach consumers -> optionally save the
rotation Lambda ARN deployed in that account -> use verify /
rotate-external-id / delete. Changing the role ARN later is a two-phase
replacement: `rebind` generates the candidate external ID for the new role's
trust policy, the `PUT` promotes it only after a successful AssumeRole, and
the whole identity value object (role ARN, external ID, role name) changes in
one write.

## HTTP surface

Request/response shape is stable across host applications:

```
GET    /aws-cross-account-bindings/accounts
GET    /aws-cross-account-bindings/accounts/:accountId
POST   /aws-cross-account-bindings/accounts/:accountId/bootstrap
PUT    /aws-cross-account-bindings/accounts/:accountId
POST   /aws-cross-account-bindings/accounts/:accountId/rebind
DELETE /aws-cross-account-bindings/accounts/:accountId/rebind
POST   /aws-cross-account-bindings/accounts/:accountId/verify
POST   /aws-cross-account-bindings/accounts/:accountId/rotate-external-id
DELETE /aws-cross-account-bindings/accounts/:accountId

GET    /aws-cross-account-bindings/consumers/:consumerId
PUT    /aws-cross-account-bindings/consumers/:consumerId
DELETE /aws-cross-account-bindings/consumers/:consumerId
```

The account list carries `consumerIds` per account so a host can render the
account card (referencing projects, delete guard) without a second lookup.
