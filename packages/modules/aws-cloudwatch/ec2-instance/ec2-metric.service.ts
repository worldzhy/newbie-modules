import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { MetricData } from "../aws-cloudwatch.interface";
import { AwsCloudwatchService } from "../aws-cloudwatch.service";
import { AwsCloudwatchCredentialService } from "../aws-cloudwatch-credential.service";
import dayjs from "dayjs";
import { GetWatchedEC2InstancesMetricDto } from "@modules/aws-cloudwatch/ec2-instance/ec2-metric.dto";

@Injectable()
export class Ec2MetricService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudwatchCredential: AwsCloudwatchCredentialService,
    private readonly cloudwatchService: AwsCloudwatchService,
  ) {}

  async getWatchedInstancesMetric(data: GetWatchedEC2InstancesMetricDto) {
    const { awsAccountId, metricName, startTime, endTime, period, statistics } = data;
    const awsAccount = await this.prisma.awsAccount.findUniqueOrThrow({
      where: { id: awsAccountId },
      include: { ec2Instances: { where: { isWatching: true }, orderBy: { createdAt: "asc" } } },
    });
    const { regions, accessKeyId, secretAccessKey } = await this.cloudwatchCredential.resolve(awsAccountId);

    if (awsAccount.ec2Instances.length === 0) {
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
        ec2InstanceRemoteIds: awsAccount.ec2Instances
          .filter((item) => item.region === region)
          .map((item) => item.instanceId),
        metricName,
        region: region.replaceAll("_", "-"),
        startTime: dayjs(startTime).toDate(),
        endTime: dayjs(endTime).toDate(),
        period: periodNum,
        statistics,
        accessKeyId,
        secretAccessKey,
      };

      const metricData = await this.cloudwatchService.getEC2InstancesMetric(params);
      results.push(...metricData);
    }

    return results;
  }
}
