import { Injectable } from "@nestjs/common";
import { AwsCrossAccountBindingsService } from "@modules/aws-identity/aws-cross-account-bindings.service";
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
  constructor(private readonly credentialService: AwsCrossAccountBindingsService) {}

  async resolve(projectId: string): Promise<ResolvedCloudwatchCredential> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    return {
      regions: credential.regions,
      credentials: credential.credentials,
    };
  }
}
