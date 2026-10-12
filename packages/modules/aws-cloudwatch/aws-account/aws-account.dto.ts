import { ApiProperty } from "@nestjs/swagger";

/**
 * Response DTO for AwsAccount.
 *
 * AwsAccount is an internal anchor row (12-digit AWS account id) referenced
 * by Ec2Instance/RdsInstance foreign keys. Credentials and the region scope
 * resolve from the project-shared aws-identity cross-account binding at
 * runtime; nothing is stored on this model.
 */
export class AwsAccountResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: String })
  awsAccountId: string;

  @ApiProperty({ type: Date })
  createdAt: Date;

  @ApiProperty({ type: Date })
  updatedAt: Date;
}
