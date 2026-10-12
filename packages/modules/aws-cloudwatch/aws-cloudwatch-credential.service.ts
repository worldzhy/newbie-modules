import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AwsCredentialsService } from "@modules/aws-identity/aws-credentials.service";
import type { AwsCredentialsProvider } from "@modules/aws-identity/aws-sts.helper";

export interface ResolvedCloudwatchCredential {
  /** Anchor AwsAccount row id, referenced by Ec2Instance/RdsInstance rows. */
  awsAccountId: string;
  /** Region scope owned by the project credential binding (e.g. "us-east-1"). */
  regions: string[];
  credentials: AwsCredentialsProvider;
}

/** Extracts the 12-digit account id from "arn:aws:iam::<account>:...". */
function parseAccountIdFromRoleArn(roleArn: string): string | null {
  const match = /^arn:aws[^:]*:iam::(\d{12}):/.exec(roleArn);
  return match ? match[1] : null;
}

/**
 * Resolves the cross-account role used by CloudWatch data collection.
 *
 * aws-cloudwatch never stores credentials itself: the single source of truth
 * is the project-shared AwsCrossAccountBinding managed by aws-identity, which
 * also owns the region scope. The AwsAccount row is an internal anchor for
 * Ec2Instance/RdsInstance foreign keys, lazily ensured here on first use
 * (account id parsed from the binding role ARN) instead of being created
 * through an explicit API call.
 */
@Injectable()
export class AwsCloudwatchCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialService: AwsCredentialsService,
  ) {}

  /**
   * Ensures the anchor AwsAccount row exists for the project credential and
   * that the project links to it, returning the anchor row id. Safe to call
   * repeatedly; keeping Project.awsAccountId pointed at the binding-derived
   * anchor is also what drives the project's hasAwsMonitor signal.
   */
  async ensureAwsAccount(projectId: string): Promise<string> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    return this.ensureAnchor(projectId, credential.roleArn);
  }

  async resolve(projectId: string): Promise<ResolvedCloudwatchCredential> {
    const credential = await this.credentialService.resolveProjectCredential(projectId);
    const awsAccountId = await this.ensureAnchor(projectId, credential.roleArn);
    return {
      awsAccountId,
      regions: credential.regions,
      credentials: credential.credentials,
    };
  }

  private async ensureAnchor(projectId: string, roleArn: string): Promise<string> {
    const awsAccountId = parseAccountIdFromRoleArn(roleArn);
    if (!awsAccountId) {
      throw new BadRequestException("Cannot resolve the AWS account id from the configured role ARN");
    }

    const awsAccount = await this.prisma.awsAccount.upsert({
      where: { awsAccountId },
      create: { awsAccountId },
      update: {},
    });

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { awsAccountId: true },
    });
    if (project.awsAccountId !== awsAccount.id) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { awsAccountId: awsAccount.id },
      });
    }

    return awsAccount.id;
  }
}
