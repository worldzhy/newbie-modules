import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

export interface AwsCallerIdentity {
  accountId: string | null;
  arn: string | null;
  userId: string | null;
  iamUserName: string | null;
}

/**
 * Temporary credentials exchanged via STS AssumeRole. Structurally compatible
 * with the AWS SDK v3 AwsCredentialIdentity shape, so values of this type can
 * be passed directly as the client `credentials` option.
 */
export interface AwsTemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

/**
 * Lazy credential source handed to AWS SDK clients. Implementations return
 * unexpired credentials and are allowed to refresh sessions on every call.
 */
export type AwsCredentialsProvider = () => Promise<AwsTemporaryCredentials>;

const ROLE_SESSION_DURATION_SECONDS = 3600;
const DEFAULT_STS_REGION = "us-east-1";

/**
 * Assume a customer-managed role. The STS client itself uses the platform
 * default credential chain (SSO / instance profile); only the trust policy on
 * the customer role authorizes the assumption together with the external ID.
 */
export async function assumeRole(params: {
  roleArn: string;
  externalId: string;
  region: string;
  sessionName: string;
  durationSeconds?: number;
}): Promise<{ credentials: AwsTemporaryCredentials; expiration: Date | null }> {
  const client = new STSClient({ region: params.region });
  const response = await client.send(
    new AssumeRoleCommand({
      RoleArn: params.roleArn,
      RoleSessionName: params.sessionName,
      ExternalId: params.externalId,
      DurationSeconds: params.durationSeconds ?? ROLE_SESSION_DURATION_SECONDS,
    }),
  );
  if (!response.Credentials?.AccessKeyId || !response.Credentials.SecretAccessKey) {
    throw new Error("STS AssumeRole returned no credentials");
  }
  return {
    credentials: {
      accessKeyId: response.Credentials.AccessKeyId,
      secretAccessKey: response.Credentials.SecretAccessKey,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration,
    },
    expiration: response.Credentials.Expiration ?? null,
  };
}

export async function getCallerIdentity(
  credentials: AwsCredentialsProvider | AwsTemporaryCredentials,
  region: string,
): Promise<AwsCallerIdentity> {
  const client = new STSClient({ region, credentials });
  const response = await client.send(new GetCallerIdentityCommand({}));
  return {
    accountId: response.Account || null,
    arn: response.Arn || null,
    userId: response.UserId || null,
    iamUserName: extractPrincipalNameFromArn(response.Arn),
  };
}

/**
 * Resolve the platform's own AWS account via the SDK default credential
 * chain. Used to render the Principal in the customer-facing trust policy;
 * the result is informational and must be cached by the caller.
 */
export async function getPlatformCallerIdentity(region = DEFAULT_STS_REGION): Promise<AwsCallerIdentity> {
  const client = new STSClient({ region });
  const response = await client.send(new GetCallerIdentityCommand({}));
  return {
    accountId: response.Account || null,
    arn: response.Arn || null,
    userId: response.UserId || null,
    iamUserName: extractPrincipalNameFromArn(response.Arn),
  };
}

function extractPrincipalNameFromArn(arn?: string | null): string | null {
  if (!arn) {
    return null;
  }
  if (arn.endsWith(":root")) {
    return "root";
  }
  const userMatch = arn.match(/:user\/(.+)$/);
  if (userMatch?.[1]) {
    return userMatch[1].split("/").pop() || userMatch[1];
  }
  const roleMatch = arn.match(/:assumed-role\/([^/]+)\/.+$/);
  if (roleMatch?.[1]) {
    return roleMatch[1];
  }
  return null;
}
