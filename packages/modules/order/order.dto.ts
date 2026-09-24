import {CommonListRequestDto, CommonListResponseDto} from '@devbie/newbie/common.dto';
import {ApiProperty} from '@nestjs/swagger';
import {OrderStatus, PaymentMethod} from '@generated/prisma/client';
import {IsArray, IsIn, IsOptional, IsString} from 'class-validator';
import {OrderEntity, OrderItemRequestEntity} from './order.entity';

export class CreateOrderRequestDto {
  @ApiProperty({type: String, required: true})
  @IsString()
  @IsIn(Object.values(PaymentMethod))
  paymentMethod: PaymentMethod;

  @ApiProperty({type: OrderItemRequestEntity, isArray: true, required: true})
  @IsArray()
  items: OrderItemRequestEntity[];

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateOrderResponseDto {
  @ApiProperty({type: String})
  id: string;

  @ApiProperty({enum: OrderStatus})
  status: OrderStatus;

  @ApiProperty({type: Number})
  totalInCents: number;

  @ApiProperty({enum: PaymentMethod})
  paymentMethod: PaymentMethod;

  @ApiProperty({type: String, required: false})
  note?: string;

  @ApiProperty({type: String})
  userId: string;
}

export class ListOrdersRequestDto extends CommonListRequestDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  userId?: string;
}

export class ListOrdersResponseDto extends CommonListResponseDto {
  @ApiProperty({type: OrderEntity, isArray: true})
  declare records: OrderEntity[];
}

export class UpdateOrderRequestDto {
  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  @ApiProperty({type: String, required: false})
  @IsString()
  @IsOptional()
  note?: string;
}

export class UpdateOrderResponseDto extends CreateOrderResponseDto {}
