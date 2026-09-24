import {ApiProperty} from '@nestjs/swagger';
import {CommonListRequestDto} from '@devbie/newbie/common.dto';
import {BillingCycle, SubscriptionStatus} from '@generated/prisma/client';
import {IsEnum, IsNumber, IsOptional, IsString} from 'class-validator';
import {Type} from 'class-transformer';

// Subscription Plan Dtos
export class ListSubscriptionPlansRequestDto extends CommonListRequestDto {}

export class CreateSubscriptionPlanRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  name: string;

  @ApiProperty({type: String, enum: BillingCycle, required: true})
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  priceInCents: number;
}

export class UpdateSubscriptionPlanRequestDto {
  @ApiProperty({type: String, required: false})
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({type: Number, required: false})
  @IsOptional()
  @IsNumber()
  priceInCents?: number;

  @ApiProperty({type: String, enum: BillingCycle, required: false})
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;
}

export class GetSubscriptionPlanRequestDto {
  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  id: number;
}

// Subscription Dtos
export class ListSubscriptionsRequestDto extends CommonListRequestDto {}

export class CreateSubscriptionRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  userId: string;

  @ApiProperty({type: Number, required: true})
  @IsNumber()
  @Type(() => Number)
  planId: number;
}

export class UpdateSubscriptionRequestDto {
  @ApiProperty({type: String, enum: SubscriptionStatus, required: true})
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;
}

export class GetSubscriptionRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  id: string;
}
