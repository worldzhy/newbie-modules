import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AwsResourceStack, AwsResourceStackState, PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsCloudformationService } from "@modules/aws-cloudformation/aws-cloudformation.service";
import { StackCommandResult } from "./stack.service";
import { StackSnapshot } from "./stack.helper";
import { AppHostStack } from "./app-host.stack";
import { ListStacksRequestDto, RunStackCommandRequestDto } from "./stack.dto";

@ApiTags("AWS CloudFormation Stack")
@ApiBearerAuth()
@Controller("aws-cloudformation-stacks")
export class AwsCloudformationStackController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudformationService: AwsCloudformationService,
  ) {}

  @Get("types")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse({ type: String, isArray: true })
  listStackTypes(): string[] {
    return this.cloudformationService.listStackTypes();
  }

  @Get("params")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse({ type: Object })
  getStackParams(@Query("type") type: string): Record<string, string> {
    return this.cloudformationService.getStackParams(type);
  }

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsResourceStack)
  @ApiCreatedResponse()
  @ApiBody({
    description: "Register a stack record; nothing is created on AWS yet.",
    examples: {
      a: {
        summary: "1. APP_HOST stack",
        value: {
          type: AppHostStack.type,
          name: "project-prod",
          params: {
            ProjectKey: "project",
            EnvironmentName: "prod",
            InstanceType: "t3.small",
            VpcId: "<vpc-id>",
            SubnetIds: "<subnet-id>",
            Domain: "app.example.com",
            HostedZoneId: "<hosted-zone-id>",
            RepositoryFullName: "owner/repo",
            Branch: "main",
            GitHubOidcProviderArn: "<oidc-provider-arn>",
          },
          environmentId: "<environment-id>",
        },
      },
    },
  })
  async createStack(@Body() body: Prisma.AwsResourceStackUncheckedCreateInput): Promise<AwsResourceStack> {
    return await this.prisma.awsResourceStack.create({ data: body });
  }

  @Get("")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async list(@Query() query: ListStacksRequestDto) {
    const { environmentId } = query;
    return await this.prisma.findManyInOnePage({
      model: Prisma.ModelName.AwsResourceStack,
      findManyArgs: { where: { environmentId } },
    });
  }

  @Get(":stackId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async getStack(@Param("stackId") stackId: string): Promise<AwsResourceStack> {
    return await this.prisma.awsResourceStack.findUniqueOrThrow({ where: { id: stackId } });
  }

  @Patch(":stackId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  @ApiBody({
    description: "Update stack parameters before creating the stack on AWS.",
    examples: {
      a: {
        summary: "1. Change the host size",
        value: { params: { InstanceType: "t3.medium" } },
      },
    },
  })
  async updateStack(
    @Param("stackId") stackId: string,
    @Body() body: Prisma.AwsResourceStackUpdateInput,
  ): Promise<AwsResourceStack> {
    return await this.prisma.awsResourceStack.update({ where: { id: stackId }, data: body });
  }

  @Delete(":stackId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async deleteStackRecord(@Param("stackId") stackId: string): Promise<AwsResourceStack> {
    const stack = await this.prisma.awsResourceStack.findUniqueOrThrow({ where: { id: stackId } });
    if (stack.state !== AwsResourceStackState.PENDING && stack.state !== AwsResourceStackState.DELETE_COMPLETE) {
      throw new BadRequestException(
        "The stack record can not be deleted because the infrastructure resource is still there.",
      );
    }
    return await this.prisma.awsResourceStack.delete({ where: { id: stackId } });
  }

  //* Idempotent create + wait for CREATE_COMPLETE.
  @Post(":stackId/get-or-create")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsResourceStack)
  @ApiCreatedResponse()
  async getOrCreateStack(@Param("stackId") stackId: string): Promise<StackSnapshot> {
    return await this.cloudformationService.getOrCreateStack(stackId);
  }

  //* Report the current AWS state; null when the stack no longer exists.
  @Get(":stackId/status")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async describeStack(@Param("stackId") stackId: string): Promise<StackSnapshot | null> {
    return await this.cloudformationService.describeStack(stackId);
  }

  //* Delete + wait for DELETE_COMPLETE.
  @Post(":stackId/delete")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async deleteStack(@Param("stackId") stackId: string): Promise<StackSnapshot> {
    return await this.cloudformationService.deleteStack(stackId);
  }

  //* Run shell commands on the host instance through SSM.
  @Post(":stackId/command")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  @ApiBody({ type: RunStackCommandRequestDto })
  async sendCommand(
    @Param("stackId") stackId: string,
    @Body() body: RunStackCommandRequestDto,
  ): Promise<StackCommandResult> {
    return await this.cloudformationService.sendCommand(stackId, body.commands);
  }
}
