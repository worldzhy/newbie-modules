import { Controller, Get, Param } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AwsAccountResponseDto } from "@modules/aws-cloudwatch/aws-account/aws-account.dto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@ApiTags("AWS CloudWatch / Account")
@ApiBearerAuth()
@Controller("awsAccounts")
export class AWSAccountController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id")
  @ApiOperation({ summary: "Get an AWS account anchor by id" })
  @ApiResponse({ type: AwsAccountResponseDto })
  async getAWSAccount(@Param("id") id: string) {
    return await this.prisma.awsAccount.findUniqueOrThrow({
      where: { id },
    });
  }
}
