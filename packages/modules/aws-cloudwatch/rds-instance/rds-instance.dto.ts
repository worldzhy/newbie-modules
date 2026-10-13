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
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { BooleanTransformer } from "@devbie/newbie/transformers/boolean.transformer";
import { CloudwatchMetricRDSMetricName, CloudwatchMetricStatistics } from "../aws-cloudwatch.enum";

/**
 * Response DTO for an RDS instance record.
 */
export class RdsInstanceResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  instanceId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  status: string;

  @ApiProperty({ type: String })
  region: string;

  @ApiProperty({ type: Boolean })
  isWatching: boolean;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class ListRDSInstancesDto {
  @ApiProperty()
  @IsUUID()
  projectId: string;

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
  @ApiProperty()
  @IsUUID()
  projectId: string;
}

export class SyncRDSInstancesWatchDto {
  @ApiProperty({ type: String })
  @IsUUID()
  projectId: string;

  @ApiProperty({ type: [String], minLength: 0 })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  watchRDSInstanceIds: string[];

  @ApiProperty({ type: [String], minLength: 0 })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  unwatchRDSInstanceIds: string[];
}

export class GetWatchedRDSInstancesMetricDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID("4")
  projectId: string;

  @ApiProperty({ enum: CloudwatchMetricRDSMetricName })
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricRDSMetricName)
  metricName: CloudwatchMetricRDSMetricName;

  @ApiProperty()
  @IsNotEmpty()
  startTime: string;

  @ApiProperty()
  @IsNotEmpty()
  endTime: string;

  @ApiProperty({ description: "The period must be a multiple of 60" })
  @IsNumberString()
  period: string;

  @ApiProperty({ enum: CloudwatchMetricStatistics })
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics: CloudwatchMetricStatistics;
}
