import { IsEnum, IsNotEmpty, IsNumberString, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { CloudwatchEC2MetricName, CloudwatchMetricStatistics } from "../aws-cloudwatch.enum";

/** AWS account ids are 12 digits; the account is this module's scope key. */
const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

export class GetWatchedEC2InstancesMetricRequestDto {
  @ApiProperty({ description: "12-digit AWS account id" })
  @IsNotEmpty()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account id" })
  accountId!: string;

  @ApiProperty({
    enum: CloudwatchEC2MetricName,
    enumName: "CloudwatchEC2MetricName",
  })
  @IsNotEmpty()
  @IsEnum(CloudwatchEC2MetricName)
  metricName!: CloudwatchEC2MetricName;

  @ApiProperty()
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty()
  @IsNotEmpty()
  endTime!: string;

  @ApiProperty({
    type: Number,
    description: "The period must be a multiple of 60",
  })
  @IsNumberString()
  period!: string;

  @ApiProperty({ enum: CloudwatchMetricStatistics, enumName: "CloudwatchMetricStatistics" })
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics!: CloudwatchMetricStatistics;
}
