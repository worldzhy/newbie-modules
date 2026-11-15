import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { AwsCrossAccountBindingsService } from "@modules/aws-identity/aws-cross-account-bindings.service";

@Injectable()
export class RdsInstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bindings: AwsCrossAccountBindingsService,
  ) {}

  async listRDSInstances(params: { accountId: string; status?: string; isWatching?: boolean }) {
    const { accountId, status, isWatching } = params;
    return await this.prisma.rdsInstance.findMany({
      where: { accountId, status, isWatching },
      orderBy: { name: "asc" },
    });
  }

  async fetchRDSInstances(accountId: string) {
    const { credentials, regions } = await this.bindings.resolveAccountCredential(accountId);
    const rdsInstances: {
      instanceId: string;
      name: string;
      status: string;
      region: string;
      accountId: string;
    }[] = [];

    for (let i = 0; i < regions.length; i++) {
      // Binding regions are stored in AWS SDK form (e.g. "us-east-1").
      const client = new RDSClient({
        region: regions[i],
        credentials,
      });

      const response = await client.send(new DescribeDBInstancesCommand());
      if (response.DBInstances) {
        for (const instance of response.DBInstances) {
          let name: string | null = null;
          if (instance.TagList) {
            const nameTag = instance.TagList.find((tag) => tag.Key === "Name");
            if (nameTag && nameTag.Value) {
              name = nameTag.Value;
            }
          }
          rdsInstances.push({
            instanceId: instance.DbiResourceId!,
            name: instance.DBInstanceIdentifier ?? name ?? instance.DbiResourceId!,
            status: instance.DBInstanceStatus!,
            region: regions[i],
            accountId,
          });
        }
      }
    }

    if (rdsInstances.length) {
      await this.prisma.$transaction(async (tx) => {
        const currentRemoteIdObjs = await tx.rdsInstance.findMany({
          where: { accountId },
          select: { instanceId: true },
        });
        const rdsInstanceRemoteIds = rdsInstances.map((item) => item.instanceId);
        const deleteIds = currentRemoteIdObjs
          .filter((item) => !rdsInstanceRemoteIds.includes(item.instanceId))
          .map((item) => item.instanceId);
        if (deleteIds.length) {
          await tx.rdsInstance.deleteMany({ where: { accountId, instanceId: { in: deleteIds } } });
        }
        for (const rdsInstance of rdsInstances) {
          // instanceId (DbiResourceId) is globally unique and stable across renames,
          // so it remains the upsert key; the (name, region, accountId) constraint
          // encodes the account-scoped identity (ADR-059).
          await tx.rdsInstance.upsert({
            where: { instanceId: rdsInstance.instanceId },
            update: {
              name: rdsInstance.name,
              status: rdsInstance.status,
              region: rdsInstance.region,
              accountId,
            },
            create: {
              instanceId: rdsInstance.instanceId,
              name: rdsInstance.name,
              status: rdsInstance.status,
              region: rdsInstance.region,
              accountId,
            },
          });
        }
      });
    }

    return true;
  }

  async syncRDSInstancesWatch(params: {
    accountId: string;
    watchRDSInstanceIds: string[];
    unwatchRDSInstanceIds: string[];
  }) {
    const { accountId, watchRDSInstanceIds, unwatchRDSInstanceIds } = params;
    let needWatch = false;
    let needUnwatch = false;
    if (watchRDSInstanceIds.length) {
      const watchRDSInstances = await this.prisma.rdsInstance.findMany({
        where: { id: { in: watchRDSInstanceIds }, accountId },
      });
      if (watchRDSInstances.length !== watchRDSInstanceIds.length) {
        throw new HttpException("The number of RDS instance IDs to watch does not match", HttpStatus.BAD_REQUEST);
      }
      needWatch = true;
    }
    if (unwatchRDSInstanceIds.length) {
      const unwatchRDSInstances = await this.prisma.rdsInstance.findMany({
        where: { id: { in: unwatchRDSInstanceIds }, accountId },
      });
      if (unwatchRDSInstances.length !== unwatchRDSInstanceIds.length) {
        throw new HttpException("The number of RDS instance IDs to unwatch does not match", HttpStatus.BAD_REQUEST);
      }
      needUnwatch = true;
    }

    if (needWatch || needUnwatch) {
      await this.prisma.$transaction(async (tx) => {
        if (needWatch) {
          await tx.rdsInstance.updateMany({ where: { id: { in: watchRDSInstanceIds } }, data: { isWatching: true } });
        }
        if (needUnwatch) {
          await tx.rdsInstance.updateMany({
            where: { id: { in: unwatchRDSInstanceIds } },
            data: { isWatching: false },
          });
        }
      });
    }
  }

  async watchRDSInstance(id: string) {
    return await this.prisma.rdsInstance.update({ where: { id }, data: { isWatching: true } });
  }

  async unwatchRDSInstance(id: string) {
    return await this.prisma.rdsInstance.update({ where: { id }, data: { isWatching: false } });
  }
}
