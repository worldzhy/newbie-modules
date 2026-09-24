import {ApiProperty} from '@nestjs/swagger';
import {IsArray, IsIn, IsOptional, IsString} from 'class-validator';
import {SuppressionListReason} from '@aws-sdk/client-sesv2';

export class AddSuppressedDestinationRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  emailAddress: string;

  @ApiProperty({enum: SuppressionListReason, required: true})
  @IsIn(Object.values(SuppressionListReason))
  reason: SuppressionListReason;
}

export class ListSuppressionDestinationsRequestDto {
  @ApiProperty({enum: SuppressionListReason, isArray: true, required: false})
  @IsArray()
  @IsOptional()
  @IsIn(Object.values(SuppressionListReason), {each: true})
  reasons?: SuppressionListReason[];

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  nextToken?: string;

  @ApiProperty({type: Number, required: true})
  pageSize: number;
}
