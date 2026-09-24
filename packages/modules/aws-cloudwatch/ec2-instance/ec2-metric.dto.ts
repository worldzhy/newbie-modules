import {IsEnum, IsNotEmpty, IsNumberString, IsUUID} from 'class-validator';
import {ApiProperty} from '@nestjs/swagger';
import {CloudwatchEC2MetricName, CloudwatchMetricStatistics} from '../aws-cloudwatch.enum';

export class GetWatchedEC2InstancesMetricDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID('4')
  awsAccountId: string;

  @ApiProperty({
    enum: CloudwatchEC2MetricName,
  })
  @IsNotEmpty()
  @IsEnum(CloudwatchEC2MetricName)
  metricName: CloudwatchEC2MetricName;

  @ApiProperty()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({
    type: Number,
    description: 'The period must be a multiple of 60',
  })
  @IsNumberString()
  period: string;

  @ApiProperty({enum: CloudwatchMetricStatistics})
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics: CloudwatchMetricStatistics;
}
