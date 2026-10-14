import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class ListStacksRequestDto {
  @ApiProperty({ type: String, description: "Filter stacks by environment id." })
  @IsNotEmpty()
  @IsString()
  environmentId: string;
}
