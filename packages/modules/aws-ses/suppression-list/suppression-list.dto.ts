import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsDefined, IsEnum, IsIn, IsOptional, IsString } from "class-validator";
import { SuppressionListReason } from "@aws-sdk/client-sesv2";

export class AddSuppressedDestinationRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  emailAddress!: string;

  @ApiProperty({ enum: SuppressionListReason })
  @IsIn(Object.values(SuppressionListReason))
  @IsEnum(SuppressionListReason)
  reason!: SuppressionListReason;
}

export class ListSuppressionDestinationsRequestDto {
  @ApiPropertyOptional({ enum: SuppressionListReason, isArray: true })
  @IsArray()
  @IsOptional()
  @IsIn(Object.values(SuppressionListReason), { each: true })
  @IsEnum(SuppressionListReason, { each: true })
  reasons?: SuppressionListReason[];

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  nextToken?: string;

  @ApiProperty({ type: Number })
  @IsDefined()
  pageSize!: number;
}
