import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

export class ListStacksRequestDto {
  @ApiProperty({ type: String, description: "Filter stacks by environment id." })
  @IsNotEmpty()
  @IsString()
  environmentId!: string;
}

// Create payload for a hosted stack. Only the declarative fields are accepted:
// id/state/outputs/timestamps are server-owned, so a Prisma
// `UncheckedCreateInput` cannot be used as the body type (R15-05).
export class CreateStackDto {
  @ApiPropertyOptional({ type: String, description: "Stack name; derived from type when omitted." })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ type: String, description: "Stack type, e.g. app-host." })
  @IsNotEmpty()
  @IsString()
  type!: string;

  @ApiPropertyOptional({ type: Object, description: "CloudFormation template parameters." })
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @ApiProperty({ type: String, description: "Target AWS environment id." })
  @IsNotEmpty()
  @IsString()
  environmentId!: string;
}

export class RunStackCommandRequestDto {
  @ApiProperty({
    type: [String],
    isArray: true,
    description: "Shell commands executed by AWS-RunShellScript on the host instance.",
    example: ["cd /opt/app && ./deploy.sh web"],
  })
  @IsArray()
  @IsString({ each: true })
  commands!: string[];
}
