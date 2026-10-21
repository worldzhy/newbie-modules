import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString } from "class-validator";

export class ProductEntity {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiPropertyOptional({ type: String })
  imageFileId?: string;

  @ApiProperty({ type: Number })
  priceInCents!: number;

  @ApiPropertyOptional({ type: Number })
  priceInCentsDiscounted?: number;
}

export class CreateProductRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  name!: string;

  @ApiProperty({ type: Number })
  @IsNumber()
  priceInCents!: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  priceInCentsDiscounted?: number;
}

export class CreateProductResponseDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  priceInCents!: number;

  @ApiProperty({ type: Number })
  priceInCentsDiscounted!: number;
}

export class ListProductsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  name?: string;
}

export class ListProductsResponseDto extends CommonListResponseDto {
  @ApiProperty({ type: ProductEntity, isArray: true })
  declare records: ProductEntity[];
}

export class UpdateProductRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  imageFileId?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  priceInCents?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsNumber()
  priceInCentsDiscounted?: number;
}

export class UpdateProductResponseDto extends CreateProductResponseDto {}
