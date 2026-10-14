import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";

export class ListOrganizationsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter organizations by name." })
  @IsOptional()
  @IsString()
  name?: string;
}
