import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { CommonListRequestDto } from "@devbie/newbie/common.dto";

export class ListTagsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ type: String, description: "Filter tags by name (case-insensitive contains)." })
  @IsOptional()
  @IsString()
  name?: string;
}

export class ListTagGroupsRequestDto extends CommonListRequestDto {}
