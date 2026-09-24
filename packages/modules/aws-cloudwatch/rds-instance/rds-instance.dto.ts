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
} from 'class-validator';
import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {CloudwatchMetricRDSMetricName, CloudwatchMetricStatistics} from '../aws-cloudwatch.enum';
import {Transform} from 'class-transformer';
import {BooleanTransformer} from '@devbie/newbie/transformers/boolean.transformer';
import {AWSRegion} from '@microservices/aws-cloudwatch/aws-cloudwatch.enum';

/**
 * Response DTO for an RDS instance record.
 */
export class RdsInstanceResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  instanceId: string;

  @ApiProperty({type: String})
  name: string;

  @ApiProperty({type: String})
  status: string;

  @ApiProperty({enum: AWSRegion})
  region: AWSRegion;

  @ApiProperty({type: Boolean})
  isWatching: boolean;

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;

  @ApiProperty({type: String})
  awsAccountId: string;
}

export class ListRDSInstancesDto {
  @ApiProperty()
  @IsUUID()
  awsAccountId: string;

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
  awsAccountId: string;
}

export class SyncRDSInstancesWatchDto {
  @ApiProperty({type: String})
  @IsUUID()
  awsAccountId: string;

  @ApiProperty({type: [String], minLength: 0})
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('4', {each: true})
  watchRDSInstanceIds: string[];

  @ApiProperty({type: [String], minLength: 0})
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('4', {each: true})
  unwatchRDSInstanceIds: string[];
}

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

  @ApiProperty({description: 'The period must be a multiple of 60'})
  @IsNumberString()
  period: string;

  @ApiProperty({enum: CloudwatchMetricStatistics})
  @IsNotEmpty()
  @IsEnum(CloudwatchMetricStatistics)
  statistics: CloudwatchMetricStatistics;
}
