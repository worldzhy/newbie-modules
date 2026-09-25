import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ConfigService} from '@nestjs/config';
import {decryptString} from '@devbie/newbie/utilities/crypto.util';
import {GetEC2InstancesCPUMetricParams, MetricData} from '../aws-cloudwatch.interface';
import {AwsCloudwatchService} from '../aws-cloudwatch.service';
import dayjs from 'dayjs';
import {GetWatchedEC2InstancesMetricDto} from '@modules/aws-cloudwatch/ec2-instance/ec2-metric.dto';

@Injectable()
export class Ec2MetricService {
  private readonly encryptKey: string;
  private readonly encryptIV: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly cloudwatchService: AwsCloudwatchService
  ) {
    this.encryptKey = this.configService.get('modules.cloudwatch.cryptoEncryptKey') as string;
    this.encryptIV = this.configService.get('modules.cloudwatch.cryptoEncryptIV') as string;
  }

  async getWatchedInstancesMetric(data: GetWatchedEC2InstancesMetricDto) {
    const {awsAccountId, metricName, startTime, endTime, period, statistics} = data;
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: {id: awsAccountId},
      include: {ec2Instances: {where: {isWatching: true}, orderBy: {createdAt: 'asc'}}},
    });

    if (awsAccount.ec2Instances.length === 0) {
      return [];
    }

    const periodNum = Number(period);
    // Check that the period is greater than 60 and divisible by 60.
    if (periodNum < 60) throw new HttpException('Period must be no less than 60', HttpStatus.BAD_REQUEST);
    if (periodNum % 60 !== 0) {
      throw new HttpException('The period must be a multiple of 60', HttpStatus.BAD_REQUEST);
    }
    // Check if start time and end time are valid.
    if (!dayjs(startTime).isValid()) {
      throw new HttpException('Invalid start time', HttpStatus.BAD_REQUEST);
    }
    if (!dayjs(endTime).isValid()) {
      throw new HttpException('Invalid end time', HttpStatus.BAD_REQUEST);
    }

    const results: MetricData[] = [];
    for (const region of awsAccount.regions) {
      const params: GetEC2InstancesCPUMetricParams = {
        ec2InstanceRemoteIds: awsAccount.ec2Instances
          .filter(item => item.region === region)
          .map(item => item.instanceId),
        metricName,
        region: region.replaceAll('_', '-'),
        startTime: dayjs(startTime).toDate(),
        endTime: dayjs(endTime).toDate(),
        period: periodNum,
        statistics,
        accessKeyId: awsAccount.accessKeyId,
        secretAccessKey: decryptString(awsAccount.secretAccessKey, this.encryptKey, this.encryptIV),
      };

      const metricData = await this.cloudwatchService.getEC2InstancesMetric(params);
      results.push(...metricData);
    }

    return results;
  }
}
