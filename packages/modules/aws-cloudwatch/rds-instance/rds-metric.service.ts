import {HttpException, HttpStatus, Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ConfigService} from '@nestjs/config';
import {decryptString} from '@devbie/newbie/utilities/crypto.util';
import {GetWatchedRDSInstancesMetricDto} from './rds-instance.dto';
import {GetRDSInstancesMetricParams, MetricData} from '../aws-cloudwatch.interface';
import {AwsCloudwatchService} from '../aws-cloudwatch.service';
import dayjs from 'dayjs';

@Injectable()
export class RdsMetricService {
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

  async getWatchedInstancesMetric(data: GetWatchedRDSInstancesMetricDto) {
    const {awsAccountId, startTime, endTime, period, metricName, statistics} = data;
    const awsAccount = await this.prisma.awsAccount.findUnique({
      where: {id: awsAccountId},
      include: {rdsInstances: {where: {isWatching: true}, orderBy: {createdAt: 'asc'}}},
    });
    if (!awsAccount) {
      throw new HttpException('AWS Account not found', HttpStatus.BAD_REQUEST);
    }
    const {rdsInstances} = awsAccount;
    if (!rdsInstances.length) {
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
      const params: GetRDSInstancesMetricParams = {
        rdsInstanceRemoteIds: rdsInstances.filter(item => item.region === region).map(item => item.name),
        region: region.replaceAll('_', '-'),
        startTime: dayjs(startTime).toDate(),
        endTime: dayjs(endTime).toDate(),
        period: periodNum,
        metricName,
        statistics,
        accessKeyId: awsAccount.accessKeyId,
        secretAccessKey: decryptString(awsAccount.secretAccessKey, this.encryptKey, this.encryptIV),
      };
      const metricData = await this.cloudwatchService.getRDSInstancesMetric(params);
      results.push(...metricData);
    }

    return results;
  }
}
