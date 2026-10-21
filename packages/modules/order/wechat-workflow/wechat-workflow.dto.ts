import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { OrderItemRequestEntity } from "../order.entity";

export class WechatWorkflowCreateOrderRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  wechatOpenId!: string;

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

export class WechatWorkflowUpdateOrderPaidRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  wechatTransactionId!: string;
}
