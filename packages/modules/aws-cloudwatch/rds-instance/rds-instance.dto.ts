import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { BooleanTransformer } from "@devbie/newbie/transformers/boolean.transformer";
import { CloudwatchMetricRDSMetricName, CloudwatchMetricStatistics } from "../aws-cloudwatch.enum";

/** AWS account ids are 12 digits; the account is this module's scope key. */
const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

/**
 * Response DTO for an RDS instance record.
 */
export class RdsInstanceResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  instanceId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  status!: string;

  @ApiProperty({ type: String })
  region!: string;

  @ApiProperty({ type: Boolean })
  isWatching!: boolean;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class ListRDSInstancesRequestDto {
  @ApiProperty({ description: "12-digit AWS account id" })
  @IsNotEmpty()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account id" })
  accountId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(BooleanTransformer)
  isWatching?: boolean;
}

export class FetchRDSInstancesDto {
  @ApiProperty({ description: "12-digit AWS account id" })
  @IsNotEmpty()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account id" })
  accountId!: string;
}

export class SyncRDSInstancesWatchDto {
  @ApiProperty({ type: String, description: "12-digit AWS account id" })
  @IsNotEmpty()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account id" })
  accountId!: string;

  @ApiProperty({ type: String, minLength: 0, isArray: true })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  watchRDSInstanceIds!: string[];

  @ApiProperty({ type: String, minLength: 0, isArray: true })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  unwatchRDSInstanceIds!: string[];
}

export class GetWatchedRDSInstancesMetricRequestDto {
  @ApiProperty({ description: "12-digit AWS account id" })
  @IsNotEmpty()
  @Matches(AWS_ACCOUNT_ID_PATTERN, { message: "accountId must be a 12-digit AWS account id" })
  accountId!: string;

  @ApiProperty({ enum: CloudwatchMetricRDSMetricName, enumName: "CloudwatchMetricRDSMetricName" })
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricRDSMetricName)
  metricName!: CloudwatchMetricRDSMetricName;

  @ApiProperty()
  @IsNotEmpty()
  startTime!: string;

  @ApiProperty()
  @IsNotEmpty()
  endTime!: string;

  @ApiProperty({ description: "The period must be a multiple of 60" })
  @IsNumberString()
  period!: string;

  @ApiProperty({ enum: CloudwatchMetricStatistics, enumName: "CloudwatchMetricStatistics" })
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics!: CloudwatchMetricStatistics;
}
