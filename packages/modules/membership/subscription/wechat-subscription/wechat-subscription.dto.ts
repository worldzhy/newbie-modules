import {ApiProperty} from '@nestjs/swagger';
import {IsEnum, IsNumber, IsOptional, IsString} from 'class-validator';
import {Type} from 'class-transformer';
import {SubscriptionStatus} from '@generated/prisma/client';

export class CreateWechatSubscriptionRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  wechatOpenId: string;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  planId: number;
}

export class GetWechatSubscriptionRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  id: string;
}

export class UpdateWechatSubscriptionRequestDto {
  @ApiProperty({type: String, enum: SubscriptionStatus, required: true})
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;

  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  wechatTransactionId?: string;
}
