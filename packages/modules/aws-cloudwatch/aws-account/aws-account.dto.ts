import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsString, ValidateIf} from 'class-validator';
import {AWSRegion} from '@modules/aws-cloudwatch/aws-cloudwatch.enum';

/**
 * Response DTO for AwsAccount.
 * 'secretAccessKey' is intentionally omitted from responses (always encrypted at rest).
 */
export class AwsAccountResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({type: String})
  awsAccountId: string;

  @ApiProperty({type: String})
  iamUserName: string;

  @ApiProperty({type: String})
  accessKeyId: string;

  @ApiProperty({enum: AWSRegion, isArray: true})
  regions: AWSRegion[];

  @ApiProperty({type: Date})
  createdAt: Date;

  @ApiProperty({type: Date})
  updatedAt: Date;
}

export class CreateAWSAccountDto {
  @ApiProperty({type: String, required: true})
  @IsNotEmpty()
  @IsString()
  awsAccountId: string;

  @ApiProperty({type: String})
  @IsNotEmpty()
  @IsString()
  iamUserName: string;

  @ApiProperty({type: String})
  @IsNotEmpty()
  @IsString()
  accessKeyId: string;

  @ApiProperty({type: String})
  @IsNotEmpty()
  @IsString()
  secretAccessKey: string;

  @ApiProperty({
    type: [String],
    enum: AWSRegion,
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AWSRegion, {each: true})
  regions: AWSRegion[];
}

export class UpdateAWSAccountDto {
  @ApiProperty({type: String, required: false})
  @IsNotEmpty()
  @IsString()
  awsAccountId?: string;

  @ApiPropertyOptional({type: String})
  @ValidateIf(o => o.iamUserName !== undefined)
  @IsString()
  iamUserName?: string;

  @ApiPropertyOptional({type: String})
  @ValidateIf(o => o.accessKeyId !== undefined)
  @IsString()
  accessKeyId?: string;

  @ApiPropertyOptional({type: String})
  @ValidateIf(o => o.secretAccessKey !== undefined)
  @IsString()
  secretAccessKey?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: AWSRegion,
  })
  @ValidateIf(o => o.regions !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AWSRegion, {each: true})
  regions?: AWSRegion[];
}
