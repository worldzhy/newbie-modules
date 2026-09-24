import {IsEnum, IsNotEmpty, IsNumber, IsUUID} from 'class-validator';
import {ApiProperty} from '@nestjs/swagger';
import {CloudwatchMetricRDSMetricName, CloudwatchMetricStatistics} from '../aws-cloudwatch.enum';

export class GetWatchedRDSInstancesMetricDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID('4')
  awsAccountId: string;

  @ApiProperty({enum: CloudwatchMetricRDSMetricName})
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricRDSMetricName)
  metricName: CloudwatchMetricRDSMetricName;

  @ApiProperty()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({type: Number, description: 'The period must be a multiple of 60'})
  @IsNumber()
  period: number;

  @ApiProperty({enum: CloudwatchMetricStatistics})
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics: CloudwatchMetricStatistics;
}
