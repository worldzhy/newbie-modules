import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsString } from "class-validator";
import { AWSRegion } from "@modules/aws-cloudwatch/aws-cloudwatch.enum";

/**
 * Response DTO for AwsAccount.
 * AWS access keys are not stored here; they resolve from the project-shared
 * aws-core credential at runtime.
 */
export class AwsAccountResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  awsAccountId: string;

  @ApiProperty({ enum: AWSRegion, isArray: true })
  regions: AWSRegion[];

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}

export class CreateAWSAccountDto {
  @ApiProperty({ type: String, required: true })
  @IsNotEmpty()
  @IsString()
  awsAccountId: string;

  @ApiProperty({
    type: [String],
    enum: AWSRegion,
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AWSRegion, { each: true })
  regions: AWSRegion[];
}

export class UpdateAWSAccountDto {
  @ApiPropertyOptional({
    type: [String],
    enum: AWSRegion,
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AWSRegion, { each: true })
  regions: AWSRegion[];
}
