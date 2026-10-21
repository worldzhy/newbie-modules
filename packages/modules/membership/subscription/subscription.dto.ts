import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { BillingCycle, SubscriptionStatus } from "@generated/prisma/client";
import { IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";

// Subscription Plan Dtos
export class ListSubscriptionPlansRequestDto extends CommonListRequestDto {}

export class CreateSubscriptionPlanRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiProperty({ type: String, enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiProperty({ type: Number })
  @IsNumber()
  @Type(() => Number)
  priceInCents!: number;
}

export class UpdateSubscriptionPlanRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  priceInCents?: number;

  @ApiPropertyOptional({ type: String, enum: BillingCycle })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;
}

export class GetSubscriptionPlanRequestDto {
  @ApiProperty({ type: Number })
  @IsNumber()
  @Type(() => Number)
  id!: number;
}

export class SubscriptionPlanResponseDto {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  priceInCents!: number;

  @ApiProperty({ type: String, enum: BillingCycle })
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ type: Object })
  features?: object | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class ListSubscriptionPlansResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: SubscriptionPlanResponseDto, isArray: true })
  declare records: SubscriptionPlanResponseDto[];
}

// Subscription Dtos
export class ListSubscriptionsRequestDto extends CommonListRequestDto {}

export class CreateSubscriptionRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  userId!: string;

  @ApiProperty({ type: Number })
  @IsNumber()
  @Type(() => Number)
  planId!: number;
}

export class UpdateSubscriptionRequestDto {
  @ApiProperty({ type: String, enum: SubscriptionStatus })
  @IsEnum(SubscriptionStatus)
  status: SubscriptionStatus;
}

export class GetSubscriptionRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  id!: string;
}

export class SubscriptionResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String, enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty({ type: Date })
  dateOfStart!: Date;

  @ApiProperty({ type: Date })
  dateOfEnd!: Date;

  @ApiProperty({ type: Boolean })
  autoRenew!: boolean;

  @ApiProperty({ type: Number })
  paymentAmountInCents!: number;

  @ApiPropertyOptional({ type: String })
  wechatTransactionId?: string | null;

  @ApiProperty({ type: String })
  membershipId!: string;

  @ApiProperty({ type: Number })
  planId!: number;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}

export class SubscriptionListItemResponseDto extends SubscriptionResponseDto {
  @ApiPropertyOptional({ type: String })
  cardNumber?: string | null;

  @ApiProperty({ type: String })
  userName!: string;

  @ApiProperty({ type: String })
  userPhone!: string;
}

export class ListSubscriptionsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: SubscriptionListItemResponseDto, isArray: true })
  declare records: SubscriptionListItemResponseDto[];
}
