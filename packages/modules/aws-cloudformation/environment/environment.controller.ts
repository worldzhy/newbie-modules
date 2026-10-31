import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AwsEnvironment, PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

/**
 * Cross-account AWS environments. Credentials are never stored: every AWS
 * call assumes `roleArn` (optionally guarded by `externalId`) with temporary
 * STS credentials.
 */
@ApiTags("AWS Environment")
@ApiBearerAuth()
@Controller("aws-environments")
export class AwsEnvironmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsEnvironment)
  @ApiCreatedResponse()
  @ApiBody({
    description: "Every field except externalId is required.",
    examples: {
      a: {
        summary: "1. Create",
        value: {
          name: "Production",
          awsAccountId: "123456789012",
          awsRegion: "us-east-1",
          roleArn: "arn:aws:iam::123456789012:role/host-deployer",
          externalId: "generated-external-id",
        },
      },
    },
  })
  async createEnvironment(@Body() body: Prisma.AwsEnvironmentUncheckedCreateInput): Promise<AwsEnvironment> {
    if (!body.name || !body.awsAccountId || !body.awsRegion || !body.roleArn) {
      throw new BadRequestException("name, awsAccountId, awsRegion and roleArn are required.");
    }
    return await this.prisma.awsEnvironment.create({ data: body });
  }

  @Get(":environmentId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  async getEnvironment(@Param("environmentId") environmentId: string): Promise<AwsEnvironment> {
    return await this.prisma.awsEnvironment.findUniqueOrThrow({ where: { id: environmentId } });
  }

  @Patch(":environmentId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  @ApiBody({
    description: "Update the target account, region or assumed role.",
    examples: {
      a: {
        summary: "1. Rotate the assumed role",
        value: {
          roleArn: "arn:aws:iam::123456789012:role/host-deployer-v2",
          externalId: "rotated-external-id",
        },
      },
    },
  })
  async updateEnvironment(
    @Param("environmentId") environmentId: string,
    @Body() body: Prisma.AwsEnvironmentUpdateInput,
  ): Promise<AwsEnvironment> {
    return await this.prisma.awsEnvironment.update({ where: { id: environmentId }, data: body });
  }

  @Delete(":environmentId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  async deleteEnvironment(@Param("environmentId") environmentId: string): Promise<AwsEnvironment> {
    return await this.prisma.awsEnvironment.delete({ where: { id: environmentId } });
  }
}
