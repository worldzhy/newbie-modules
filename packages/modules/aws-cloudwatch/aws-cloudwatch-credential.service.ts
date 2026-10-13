import { Injectable } from "@nestjs/common";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";
import type { AwsCredentialsProvider } from "@modules/aws-identity/aws-sts.helper";

export interface ResolvedCloudwatchCredential {
  /** Region scope owned by the project credential binding (e.g. "us-east-1"). */
  regions: string[];
  credentials: AwsCredentialsProvider;
}

/**
 * Resolves the cross-account role used by CloudWatch data collection.
 *
 * aws-cloudwatch never stores credentials itself: the single source of truth
 * is the project-shared AwsCrossAccountBinding managed by aws-identity, which
 * also owns the region scope. Instances are scoped directly by projectId.
 */
@Injectable()
export class AwsCloudwatchCredentialService {
  constructor(private readonly credentialService: AwsCredentialsService) {}

  async resolve(projectId: string): Promise<ResolvedCloudwatchCredential> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    return {
      regions: credential.regions,
      credentials: credential.credentials,
    };
  }
}
