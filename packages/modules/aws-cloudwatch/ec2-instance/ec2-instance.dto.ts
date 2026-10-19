import { ArrayMinSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { BooleanTransformer } from "@devbie/newbie/transformers/boolean.transformer";

/**
 * Response DTO for an EC2 instance record.
 */
export class Ec2InstanceResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  instanceId!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  status?: string | null;

  @ApiProperty({ type: String })
  region!: string;

  @ApiProperty({ type: Boolean })
  isWatching!: boolean;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class ListEC2InstancesRequestDto {
  @ApiProperty()
  @IsUUID()
  projectId!: string;

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

export class FetchEC2InstancesDto {
  @ApiProperty()
  @IsUUID()
  projectId!: string;
}

export class SyncEC2InstancesWatchDto {
  @ApiProperty({ type: String })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ type: [String], minLength: 0 })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  watchEC2InstanceIds!: string[];

  @ApiProperty({ type: [String], minLength: 0 })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID("4", { each: true })
  unwatchEC2InstanceIds!: string[];
}
