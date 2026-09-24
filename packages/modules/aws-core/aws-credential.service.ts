import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {decryptString, encryptString} from '@devbie/newbie/utilities/crypto.util';
import {ProjectAwsCredential} from '@generated/prisma/client';
import {UpsertProjectAwsCredentialDto} from './aws-credential.dto';
import {getCallerIdentity} from './aws-sts.helper';

const DEFAULT_REGION = 'us-east-1';

export interface ResolvedAwsCredential {
  accessKeyId: string;
  secretAccessKey: string;
  defaultRegion: string;
  regions: string[];
  awsAccountId: string | null;
  iamUserName: string | null;
}

@Injectable()
export class AwsCredentialService {
  private readonly encryptKey: string;
  private readonly encryptIV: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    const key = this.config.get<string>('microservices.aws-core.cryptoEncryptKey');
    const iv = this.config.get<string>('microservices.aws-core.cryptoEncryptIV');
    if (!key || !iv) {
      throw new Error('aws-core requires AWS_CREDENTIAL_ENCRYPT_KEY/IV to be configured.');
    }
    this.encryptKey = key;
    this.encryptIV = iv;
  }

  async getProjectCredential(projectId: string) {
    await this.ensureProjectExists(projectId);
    const record = await this.prisma.projectAwsCredential.findUnique({where: {projectId}});
    return this.serialize(projectId, record);
  }

  async upsertProjectCredential(projectId: string, dto: UpsertProjectAwsCredentialDto) {
    await this.ensureProjectExists(projectId);

    const existing = await this.prisma.projectAwsCredential.findUnique({where: {projectId}});

    const accessKeyId = dto.accessKeyId.trim();
    if (!accessKeyId) {
      throw new BadRequestException('AWS Access Key ID is required');
    }

    const secretAccessKey = this.resolveSecretAccessKey(dto.secretAccessKey, existing?.secretAccessKeyEncrypted);
    if (!secretAccessKey) {
      throw new BadRequestException('AWS Secret Access Key is required when creating a new credential');
    }

    const regions = dto.regions?.length
      ? dto.regions.map(region => this.normalizeRegion(region))
      : existing?.regions?.length
        ? existing.regions
        : [DEFAULT_REGION];
    const defaultRegion = this.normalizeRegion(dto.defaultRegion || existing?.defaultRegion || regions[0]);

    const identity = await getCallerIdentity({accessKeyId, secretAccessKey}, defaultRegion);

    const encryptedSecret = encryptString(secretAccessKey, this.encryptKey, this.encryptIV);

    const record = existing
      ? await this.prisma.projectAwsCredential.update({
          where: {id: existing.id},
          data: {
            accessKeyId,
            secretAccessKeyEncrypted: encryptedSecret,
            awsAccountId: identity.accountId || existing.awsAccountId,
            iamUserName: identity.iamUserName || existing.iamUserName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        })
      : await this.prisma.projectAwsCredential.create({
          data: {
            projectId,
            accessKeyId,
            secretAccessKeyEncrypted: encryptedSecret,
            awsAccountId: identity.accountId,
            iamUserName: identity.iamUserName,
            defaultRegion,
            regions,
            lastVerifiedAt: new Date(),
          },
        });

    return this.serialize(projectId, record);
  }

  async verifyProjectCredential(projectId: string) {
    const resolved = await this.resolveProjectCredential(projectId);
    const identity = await getCallerIdentity(
      {accessKeyId: resolved.accessKeyId, secretAccessKey: resolved.secretAccessKey},
      resolved.defaultRegion
    );

    const record = await this.prisma.projectAwsCredential.update({
      where: {projectId},
      data: {
        awsAccountId: identity.accountId || undefined,
        iamUserName: identity.iamUserName || undefined,
        lastVerifiedAt: new Date(),
      },
    });

    return {
      ...this.serialize(projectId, record),
      verification: identity,
    };
  }

  async deleteProjectCredential(projectId: string) {
    await this.ensureProjectExists(projectId);
    await this.prisma.projectAwsCredential.delete({where: {projectId}}).catch(() => undefined);
    return {projectId, configured: false};
  }

  /**
   * Read the raw decrypted AWS credential for consumption by other microservices.
   * Throws when no credential is configured for the project.
   */
  async resolveProjectCredential(projectId: string): Promise<ResolvedAwsCredential> {
    const record = await this.prisma.projectAwsCredential.findUnique({where: {projectId}});
    if (!record) {
      throw new BadRequestException('Project AWS credential not configured');
    }
    const secretAccessKey = decryptString(record.secretAccessKeyEncrypted, this.encryptKey, this.encryptIV);
    const regions = record.regions?.length ? record.regions : [DEFAULT_REGION];
    const defaultRegion = record.defaultRegion || regions[0];
    return {
      accessKeyId: record.accessKeyId,
      secretAccessKey,
      defaultRegion,
      regions,
      awsAccountId: record.awsAccountId,
      iamUserName: record.iamUserName,
    };
  }

  private resolveSecretAccessKey(input?: string, existingEncrypted?: string | null): string | null {
    const trimmed = input?.trim();
    if (trimmed) {
      return trimmed;
    }
    if (existingEncrypted) {
      return decryptString(existingEncrypted, this.encryptKey, this.encryptIV);
    }
    return null;
  }

  private normalizeRegion(region: string): string {
    return region.trim().toLowerCase();
  }

  private async ensureProjectExists(projectId: string) {
    const project = await this.prisma.project.findUnique({where: {id: projectId}, select: {id: true}});
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
  }

  private serialize(projectId: string, record: ProjectAwsCredential | null) {
    if (!record) {
      return {projectId, configured: false, credential: null};
    }
    return {
      projectId,
      configured: true,
      credential: {
        id: record.id,
        accessKeyId: record.accessKeyId,
        hasSecretAccessKey: true,
        awsAccountId: record.awsAccountId,
        iamUserName: record.iamUserName,
        defaultRegion: record.defaultRegion,
        regions: record.regions,
        status: record.status,
        lastVerifiedAt: record.lastVerifiedAt,
        updatedAt: record.updatedAt,
      },
    };
  }
}
