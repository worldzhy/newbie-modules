import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {DescribeInstancesCommand, EC2Client} from '@aws-sdk/client-ec2';
import {Prisma} from '@generated/prisma/client';
import {ConfigService} from '@nestjs/config';
import {decryptString} from '@devbie/newbie/utilities/crypto.util';

@Injectable()
export class Ec2InstanceService {
  private readonly encryptKey: string;
  private readonly encryptIV: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService
  ) {
    this.encryptKey = this.configService.get('modules.cloudwatch.cryptoEncryptKey') as string;
    this.encryptIV = this.configService.get('modules.cloudwatch.cryptoEncryptIV') as string;
  }

  async fetchEC2Instances(awsAccountId: string) {
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: {id: awsAccountId},
      omit: {
        secretAccessKey: false,
      },
    });
    const {accessKeyId, secretAccessKey, regions} = awsAccount;
    const ec2InstanceCreateManyInputs: Prisma.Ec2InstanceCreateManyInput[] = [];

    for (let i = 0; i < regions.length; i++) {
      const region = regions[i].replaceAll('_', '-');
      const client = new EC2Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey: decryptString(secretAccessKey, this.encryptKey, this.encryptIV),
        },
      });

      const response = await client.send(new DescribeInstancesCommand());
      if (response.Reservations) {
        for (const reservation of response.Reservations) {
          if (reservation.Instances) {
            for (const instance of reservation.Instances) {
              const nameTag = instance.Tags?.find(t => t.Key === 'Name');
              ec2InstanceCreateManyInputs.push({
                instanceId: instance.InstanceId!,
                name: nameTag?.Value ?? instance.InstanceId!,
                status: instance.State?.Name,
                region: regions[i],
                awsAccountId,
              });
            }
          }
        }
      }
    }

    if (ec2InstanceCreateManyInputs.length) {
      await this.prisma.$transaction(async tx => {
        const currentInstanceIdObjs = await tx.ec2Instance.findMany({
          where: {awsAccountId},
          select: {instanceId: true},
        });
        const ec2InstanceRemoteIds = ec2InstanceCreateManyInputs.map(item => item.instanceId);
        const deleteIds = currentInstanceIdObjs
          .filter(item => !ec2InstanceRemoteIds.includes(item.instanceId))
          .map(item => item.instanceId);
        if (deleteIds.length) {
          await tx.ec2Instance.deleteMany({where: {instanceId: {in: deleteIds}}});
        }
        for (const ec2Instance of ec2InstanceCreateManyInputs) {
          await tx.ec2Instance.upsert({
            where: {instanceId: ec2Instance.instanceId},
            update: {
              name: ec2Instance.name,
              status: ec2Instance.status,
              region: ec2Instance.region,
            },
            create: {
              instanceId: ec2Instance.instanceId,
              name: ec2Instance.name,
              status: ec2Instance.status,
              region: ec2Instance.region,
              awsAccountId,
            },
          });
        }
      });
    }

    return true;
  }

  async syncEC2InstancesWatch(params: {
    awsAccountId: string;
    watchEC2InstanceIds: string[];
    unwatchEC2InstanceIds: string[];
  }) {
    const {awsAccountId, watchEC2InstanceIds, unwatchEC2InstanceIds} = params;
    let needWatch = false;
    let needUnwatch = false;
    if (watchEC2InstanceIds.length) {
      const watchEC2Instances = await this.prisma.ec2Instance.findMany({
        where: {id: {in: watchEC2InstanceIds}, awsAccountId},
      });
      if (watchEC2Instances.length !== watchEC2InstanceIds.length) {
        throw new HttpException('The number of EC2 instance IDs to watch does not match', HttpStatus.BAD_REQUEST);
      }
      needWatch = true;
    }
    if (unwatchEC2InstanceIds.length) {
      const unwatchEC2Instances = await this.prisma.ec2Instance.findMany({
        where: {id: {in: unwatchEC2InstanceIds}, awsAccountId},
      });
      if (unwatchEC2Instances.length !== unwatchEC2InstanceIds.length) {
        throw new HttpException('The number of EC2 instance IDs to unwatch does not match', HttpStatus.BAD_REQUEST);
      }
      needUnwatch = true;
    }

    if (needWatch || needUnwatch) {
      await this.prisma.$transaction(async tx => {
        if (needWatch) {
          await tx.ec2Instance.updateMany({where: {id: {in: watchEC2InstanceIds}}, data: {isWatching: true}});
        }
        if (needUnwatch) {
          await tx.ec2Instance.updateMany({where: {id: {in: unwatchEC2InstanceIds}}, data: {isWatching: false}});
        }
      });
    }

    return true;
  }

  async watchEC2Instance(id: string) {
    return await this.prisma.ec2Instance.update({where: {id}, data: {isWatching: true}});
  }

  async unwatchEC2Instance(id: string) {
    return await this.prisma.ec2Instance.update({where: {id}, data: {isWatching: false}});
  }

  async getWatchingInstances(awsAccountId: string) {
    return await this.prisma.ec2Instance.findMany({where: {awsAccountId, isWatching: true}});
  }

  async getWatchingInstanceIds(awsAccountId: string) {
    const instances = await this.prisma.ec2Instance.findMany({where: {awsAccountId, isWatching: true}});
    return instances.map(instance => instance.id);
  }
}
