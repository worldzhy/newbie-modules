# newbie.aws-cloudformation

Cross-account AWS infrastructure adapter. The module owns one generic stack
type, `APP_HOST`, and four idempotent primitives. It reports AWS facts only —
whether an application deployment succeeded is the host's decision.

## Credentials

`AwsEnvironment` stores `awsAccountId`, `awsRegion`, `roleArn` and an optional
`externalId`. Every call exchanges the host identity for temporary credentials
through `sts:AssumeRole` (provided by `aws-identity`). No access key is stored.

## Primitives

| Primitive | Behaviour |
| --- | --- |
| `getOrCreateStack` | `DescribeStacks`; creates from the in-module `TemplateBody` when absent, then waits for `CREATE_COMPLETE`. A rolled-back stack is reported as failed. |
| `describeStack` | Current status and outputs; `null` when the stack does not exist. |
| `deleteStack` | Waits for `DELETE_COMPLETE`; a missing stack counts as deleted. |
| `sendCommand` | `AWS-RunShellScript` on the host instance, polls `GetCommandInvocation`, returns status, exit code and output. |

All primitives are idempotent and bounded by a deadline (timeout → HTTP 408,
terminal failure or timeout → HTTP 400/504 through the service layer).

## `APP_HOST`

One EC2 instance (IMDSv2 required, termination protection, only 80/443 open,
no SSH) with an elastic IP, an instance role (ECR pull, project-scoped
Secrets Manager read, CloudWatch Logs), an ECR repository, a GitHub Actions
OIDC role scoped to one repository and branch, an optional Route53 record and
health check, and an optional backup bucket.

Template parameters: `ProjectKey`, `EnvironmentName`, `InstanceType`, `AmiId`,
`VpcId`, `SubnetIds`, `Domain`, `HostedZoneId`, `RepositoryFullName`, `Branch`,
`GitHubOidcProviderArn`, `BackupBucketName`.

Outputs: `InstanceId`, `PublicIp`, `EcrRepositoryUri`, `CiRoleArn`, `AppUrl`,
`HealthCheckId`.

## HTTP surface

```
GET    /aws-environments/:environmentId
POST   /aws-environments
PATCH  /aws-environments/:environmentId
DELETE /aws-environments/:environmentId

GET    /aws-cloudformation-stacks/types
GET    /aws-cloudformation-stacks/params?type=APP_HOST
POST   /aws-cloudformation-stacks
GET    /aws-cloudformation-stacks
GET    /aws-cloudformation-stacks/:stackId
PATCH  /aws-cloudformation-stacks/:stackId
DELETE /aws-cloudformation-stacks/:stackId
POST   /aws-cloudformation-stacks/:stackId/get-or-create
GET    /aws-cloudformation-stacks/:stackId/status
POST   /aws-cloudformation-stacks/:stackId/delete
POST   /aws-cloudformation-stacks/:stackId/command
```
