import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";
import type { AwsCredentialsProvider } from "@modules/aws-identity/aws-sts.helper";
import { AwsRegion } from "@generated/prisma/client";

export interface ResolvedCloudwatchCredential {
  regions: AwsRegion[];
  credentials: AwsCredentialsProvider;
}

/**
 * Resolves the cross-account role used by CloudWatch data collection.
 *
 * aws-cloudwatch never stores credentials itself: the single source of truth
 * is the project-shared ProjectAwsCredential managed by aws-core. An
 * AwsAccount row is linked to a project through Project.awsAccountId, so the
 * linked project is looked up first and its AssumeRole provider is then
 * resolved via AwsCredentialService.
 */
@Injectable()
export class AwsCloudwatchCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: AwsCredentialsService,
  ) {}

  async resolve(awsAccountId: string): Promise<ResolvedCloudwatchCredential> {
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: { id: awsAccountId },
      select: { regions: true },
    });

    const project = await this.prisma.project.findFirst({
      where: { awsAccountId },
      select: { id: true },
    });
    if (!project) {
      throw new BadRequestException("No project is linked to this AWS account");
    }

    const credential = await this.credentialService.resolveProjectCredential(project.id);

    return {
      regions: awsAccount.regions,
      credentials: credential.credentials,
    };
  }
}
