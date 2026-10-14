import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GetWatchedRDSInstancesMetricRequestDto } from "./rds-instance.dto";
import { MetricData } from "../aws-cloudwatch.interface";
import { AwsCloudwatchService } from "../aws-cloudwatch.service";
import { AwsCloudwatchCredentialService } from "../aws-cloudwatch-credential.service";
import dayjs from "dayjs";

@Injectable()
export class RdsMetricService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudwatchCredential: AwsCloudwatchCredentialService,
    private readonly cloudwatchService: AwsCloudwatchService,
  ) {}

  async getWatchedInstancesMetric(data: GetWatchedRDSInstancesMetricRequestDto) {
    const { projectId, startTime, endTime, period, metricName, statistics } = data;
    const { regions, credentials } = await this.cloudwatchCredential.resolve(projectId);
    const watchedInstances = await this.prisma.rdsInstance.findMany({
      where: { projectId, isWatching: true },
      orderBy: { createdAt: "asc" },
    });
    if (!watchedInstances.length) {
      return [];
    }

    const periodNum = Number(period);
    // Check that the period is greater than 60 and divisible by 60.
    if (periodNum < 60) throw new HttpException("Period must be no less than 60", HttpStatus.BAD_REQUEST);
    if (periodNum % 60 !== 0) {
      throw new HttpException("The period must be a multiple of 60", HttpStatus.BAD_REQUEST);
    }
    // Check if start time and end time are valid.
    if (!dayjs(startTime).isValid()) {
      throw new HttpException("Invalid start time", HttpStatus.BAD_REQUEST);
    }
    if (!dayjs(endTime).isValid()) {
      throw new HttpException("Invalid end time", HttpStatus.BAD_REQUEST);
    }

    const results: MetricData[] = [];
    for (const region of regions) {
      const params = {
        rdsInstanceRemoteIds: watchedInstances.filter((item) => item.region === region).map((item) => item.name),
        region,
        startTime: dayjs(startTime).toDate(),
        endTime: dayjs(endTime).toDate(),
        period: periodNum,
        metricName,
        statistics,
        credentials,
      };
      const metricData = await this.cloudwatchService.getRDSInstancesMetric(params);
      results.push(...metricData);
    }

    return results;
  }
}
