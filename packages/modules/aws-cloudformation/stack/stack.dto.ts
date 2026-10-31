import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsNotEmpty, IsString } from "class-validator";

export class ListStacksRequestDto {
  @ApiProperty({ type: String, description: "Filter stacks by environment id." })
  @IsNotEmpty()
  @IsString()
  environmentId!: string;
}

export class RunStackCommandRequestDto {
  @ApiProperty({
    type: [String],
    description: "Shell commands executed by AWS-RunShellScript on the host instance.",
    example: ["cd /opt/app && ./deploy.sh web"],
  })
  @IsArray()
  @IsString({ each: true })
  commands!: string[];
}
