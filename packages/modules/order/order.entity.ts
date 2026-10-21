import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderStatus, PaymentMethod } from "@generated/prisma/client";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class OrderItemRequestEntity {
  @ApiProperty({ type: String })
  @IsString()
  skuId!: string;

  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiProperty({ type: Number })
  @IsNumber()
  priceInCents!: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  quantity?: number;
}

export class OrderItemResponseEntity {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  spuId!: string;

  @ApiProperty({ type: String })
  productId!: string;

  @ApiProperty({ type: Number })
  priceInCents!: number;

  @ApiProperty({ type: Number })
  quantity!: number;

  @ApiProperty({ type: Number })
  subTotalInCents!: number;
}

export class OrderEntity {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ type: Number })
  totalInCents!: number;

  @ApiProperty({ enum: PaymentMethod })
  paymentMethod: PaymentMethod;

  @ApiProperty({ type: OrderItemResponseEntity, isArray: true })
  items!: OrderItemResponseEntity[];

  @ApiPropertyOptional({ type: String })
  note?: string;

  @ApiProperty({ type: String })
  userId!: string;

  @ApiProperty({ type: String })
  userName!: string;
}
