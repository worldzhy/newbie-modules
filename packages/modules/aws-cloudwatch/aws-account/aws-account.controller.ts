import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  AwsAccountResponseDto,
  CreateAWSAccountDto,
  UpdateAWSAccountDto,
} from "@modules/aws-cloudwatch/aws-account/aws-account.dto";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@ApiTags("AWS CloudWatch / Account")
@ApiBearerAuth()
@Controller("awsAccounts")
export class AWSAccountController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id")
  @ApiOperation({ summary: "Get an AWS account by id" })
  @ApiResponse({ type: AwsAccountResponseDto })
  async getAWSAccount(@Param("id") id: string) {
    return await this.prisma.awsAccount.findUniqueOrThrow({
      where: { id },
    });
  }

  @Post()
  @ApiOperation({ summary: "Create an AWS account monitoring scope" })
  @ApiResponse({ type: AwsAccountResponseDto })
  async createAWSAccount(@Body() body: CreateAWSAccountDto) {
    return await this.prisma.awsAccount.create({
      data: {
        awsAccountId: body.awsAccountId,
        regions: body.regions,
      },
    });
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update the monitored regions of an AWS account" })
  @ApiResponse({ type: AwsAccountResponseDto })
  async updateAWSAccount(@Param("id") id: string, @Body() body: UpdateAWSAccountDto) {
    return await this.prisma.awsAccount.update({
      where: { id },
      data: {
        regions: body.regions,
      },
    });
  }
}
