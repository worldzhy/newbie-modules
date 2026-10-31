import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";

export class CreateOrganizationRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateOrganizationRequestDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;
}

export class ListOrganizationsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter organizations by name." })
  @IsOptional()
  @IsString()
  name?: string;
}
