import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

// Create payload for a cross-account target. Server-owned fields (id, timestamps,
// relations) are excluded so a Prisma UncheckedCreateInput cannot be used as the
// request body (R15-05).
export class CreateEnvironmentDto {
  @ApiProperty({ type: String, example: "Production" })
  @IsNotEmpty()
  @IsString()
  name!: string;

  @ApiProperty({ type: String, example: "123456789012" })
  @IsNotEmpty()
  @IsString()
  awsAccountId!: string;

  @ApiProperty({ type: String, example: "us-east-1" })
  @IsNotEmpty()
  @IsString()
  awsRegion!: string;

  @ApiProperty({ type: String, example: "arn:aws:iam::123456789012:role/host-deployer" })
  @IsNotEmpty()
  @IsString()
  roleArn!: string;

  @ApiPropertyOptional({ type: String, description: "STS AssumeRole external id." })
  @IsOptional()
  @IsString()
  externalId?: string;
}
