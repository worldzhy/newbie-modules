import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderStatus, PaymentMethod } from "@generated/prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { OrderEntity, OrderItemRequestEntity } from "./order.entity";

export class CreateOrderRequestDto {
  @ApiProperty({ type: String, enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiProperty({ type: OrderItemRequestEntity, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemRequestEntity)
  items!: OrderItemRequestEntity[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateOrderResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ type: Number })
  totalInCents!: number;

  @ApiProperty({ enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ type: String })
  note?: string;

  @ApiProperty({ type: String })
  userId!: string;
}

export class ListOrdersRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  userId?: string;
}

export class ListOrdersResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: OrderEntity, isArray: true })
  declare records: OrderEntity[];
}

export class UpdateOrderRequestDto {
  @ApiPropertyOptional({ type: String, enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateOrderResponseDto extends CreateOrderResponseDto {}
