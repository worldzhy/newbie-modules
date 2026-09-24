import {GetCallerIdentityCommand, STSClient} from '@aws-sdk/client-sts';

export interface AwsCallerIdentity {
  accountId: string | null;
  arn: string | null;
  userId: string | null;
  iamUserName: string | null;
}

export async function getCallerIdentity(
  credentials: {accessKeyId: string; secretAccessKey: string},
  region: string
): Promise<AwsCallerIdentity> {
  const client = new STSClient({region, credentials});
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
  if (arn.endsWith(':root')) {
    return 'root';
  }
  const userMatch = arn.match(/:user\/(.+)$/);
  if (userMatch?.[1]) {
    return userMatch[1].split('/').pop() || userMatch[1];
  }
  const roleMatch = arn.match(/:assumed-role\/([^/]+)\/.+$/);
  if (roleMatch?.[1]) {
    return roleMatch[1];
  }
  return null;
}
