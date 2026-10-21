import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNumber, IsOptional, IsString } from "class-validator";
import { Type } from "class-transformer";
import { SubscriptionStatus } from "@generated/prisma/client";

export class CreateWechatSubscriptionRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  wechatOpenId!: string;

  @ApiProperty({ type: Number })
  @IsNumber()
  @Type(() => Number)
  planId!: number;
}

export class GetWechatSubscriptionRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  id!: string;
}

export class UpdateWechatSubscriptionRequestDto {
  @ApiProperty({ type: String, enum: SubscriptionStatus })
  @IsEnum(SubscriptionStatus)
  status!: SubscriptionStatus;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  wechatTransactionId?: string;
}
