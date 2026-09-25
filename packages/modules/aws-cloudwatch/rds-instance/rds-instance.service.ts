import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {DescribeDBInstancesCommand, RDSClient} from '@aws-sdk/client-rds';
import {AwsRegion} from '@generated/prisma/client';
import {ConfigService} from '@nestjs/config';
import {decryptString} from '@devbie/newbie/utilities/crypto.util';

@Injectable()
export class RdsInstanceService {
  private readonly encryptKey: string;
  private readonly encryptIV: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {
    this.encryptKey = this.configService.get('modules.cloudwatch.cryptoEncryptKey') as string;
    this.encryptIV = this.configService.get('modules.cloudwatch.cryptoEncryptIV') as string;
  }

  async fetchRDSInstances(awsAccountId: string) {
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: {id: awsAccountId},
      omit: {
        secretAccessKey: false,
      },
    });
    const {accessKeyId, secretAccessKey, regions} = awsAccount;
    const rdsInstances: {
      instanceId: string;
      name: string;
      status: string;
      region: AwsRegion;
      awsAccountId: string;
    }[] = [];

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i].replaceAll('_', '-');
      const client = new RDSClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey: decryptString(secretAccessKey, this.encryptKey, this.encryptIV),
        },
      });

      const response = await client.send(new DescribeDBInstancesCommand());
      if (response.DBInstances) {
        for (const instance of response.DBInstances) {
          let name: string | null = null;
          if (instance.TagList) {
            const nameTag = instance.TagList.find(tag => tag.Key === 'Name');
            if (nameTag && nameTag.Value) {
              name = nameTag.Value;
            }
          }
          rdsInstances.push({
            instanceId: instance.DbiResourceId!,
            name: instance.DBInstanceIdentifier ?? name ?? instance.DbiResourceId!,
            status: instance.DBInstanceStatus!,
            region: regions[i],
            awsAccountId,
          });
        }
      }
    }

    if (rdsInstances.length) {
      await this.prisma.$transaction(async tx => {
        const currentRemoteIdObjs = await tx.rdsInstance.findMany({where: {awsAccountId}, select: {instanceId: true}});
        const rdsInstanceRemoteIds = rdsInstances.map(item => item.instanceId);
        const deleteIds = currentRemoteIdObjs
          .filter(item => !rdsInstanceRemoteIds.includes(item.instanceId))
          .map(item => item.instanceId);
        if (deleteIds.length) {
          await tx.rdsInstance.deleteMany({where: {awsAccountId, instanceId: {in: deleteIds}}});
        }
        for (const rdsInstance of rdsInstances) {
          await tx.rdsInstance.upsert({
            where: {instanceId: rdsInstance.instanceId},
            update: {
              name: rdsInstance.name,
              status: rdsInstance.status,
              region: rdsInstance.region,
            },
            create: {
              instanceId: rdsInstance.instanceId,
              name: rdsInstance.name,
              status: rdsInstance.status,
              region: rdsInstance.region,
              awsAccountId,
            },
          });
        }
      });
    }

    return true;
  }

  async syncRDSInstancesWatch(params: {
    awsAccountId: string;
    watchRDSInstanceIds: string[];
    unwatchRDSInstanceIds: string[];
  }) {
    const {awsAccountId, watchRDSInstanceIds, unwatchRDSInstanceIds} = params;
    let needWatch = false;
    let needUnwatch = false;
    if (watchRDSInstanceIds.length) {
      const watchRDSInstances = await this.prisma.rdsInstance.findMany({
        where: {id: {in: watchRDSInstanceIds}, awsAccountId},
      });
      if (watchRDSInstances.length !== watchRDSInstanceIds.length) {
        throw new HttpException('The number of RDS instance IDs to watch does not match', HttpStatus.BAD_REQUEST);
      }
      needWatch = true;
    }
    if (unwatchRDSInstanceIds.length) {
      const unwatchRDSInstances = await this.prisma.rdsInstance.findMany({
        where: {id: {in: unwatchRDSInstanceIds}, awsAccountId},
      });
      if (unwatchRDSInstances.length !== unwatchRDSInstanceIds.length) {
        throw new HttpException('The number of RDS instance IDs to unwatch does not match', HttpStatus.BAD_REQUEST);
      }
      needUnwatch = true;
    }

    if (needWatch || needUnwatch) {
      await this.prisma.$transaction(async tx => {
        if (needWatch) {
          await tx.rdsInstance.updateMany({where: {id: {in: watchRDSInstanceIds}}, data: {isWatching: true}});
        }
        if (needUnwatch) {
          await tx.rdsInstance.updateMany({
            where: {id: {in: unwatchRDSInstanceIds}},
            data: {isWatching: false},
          });
        }
      });
    }
  }

  async watchRDSInstance(id: string) {
    return await this.prisma.rdsInstance.update({where: {id}, data: {isWatching: true}});
  }

  async unwatchRDSInstance(id: string) {
    return await this.prisma.rdsInstance.update({where: {id}, data: {isWatching: false}});
  }

  async getWatchingInstances(awsAccountId: string) {
    return await this.prisma.rdsInstance.findMany({where: {awsAccountId, isWatching: true}});
  }

  async getWatchingInstanceIds(awsAccountId: string) {
    const instances = await this.prisma.rdsInstance.findMany({where: {awsAccountId, isWatching: true}});
    return instances.map(instance => instance.id);
  }
}
