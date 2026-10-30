import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AwsResourceStack, AwsResourceStackState, PermissionAction, Prisma } from "@generated/prisma/client";
import { CloudFormationStackType } from "@modules/aws-cloudformation/stack/stack.service";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsCloudformationService } from "@modules/aws-cloudformation/aws-cloudformation.service";
import { ListStacksRequestDto } from "./stack.dto";

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
  listStackTypes() {
    return this.cloudformationService.listStackTypes();
  }

  @Get("params")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse({ type: Object })
  async getStackParams(@Query("type") type: string, @Query("manager") manager: string) {
    return this.cloudformationService.getStackParams({ manager, type });
  }

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsResourceStack)
  @ApiCreatedResponse()
  @ApiBody({
    description: "Create infrastructure stack.",
    examples: {
      a: {
        summary: "1. CloudFormation stack",
        value: {
          type: CloudFormationStackType.MESSAGE_TRACKER,
          params: {
            DatabaseHost: "solidcore-dev.ccjlptnm8vot.us-east-1.rds.amazonaws.com",
            DatabasePort: "5432",
            DatabaseMasterUsername: "postgres",
            DatabaseMasterUserPassword: "postgres",
            DatabaseName: "postgres",
            SESIdentityARN: "arn:aws:ses:us-east-1:196438055748:identity/info@solidcore.co",
            FromAddress: "info@solidcore.co",
          },
          environmentId: "013f92b0-4a53-45cb-8eca-e66089a3919f",
        },
      },
    },
  })
  async createStack(
    @Body()
    body: Prisma.AwsResourceStackUncheckedCreateInput,
  ): Promise<AwsResourceStack> {
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
    return await this.prisma.awsResourceStack.findUniqueOrThrow({
      where: { id: stackId },
    });
  }

  @Patch(":stackId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  @ApiBody({
    description: "Update infrastructure stack.",
    examples: {
      a: {
        summary: "1. AWS VPC stack",
        value: {
          params: {
            vpcName: "pulumi-test-vpc-modified",
            vpcCidrBlock: "10.21.0.0/16",
          },
        },
      },
      b: {
        summary: "2. Database stack",
        value: {
          params: {
            instanceName: "postgres-default-modified",
            instanceClass: "db.t3.small",
          },
        },
      },
    },
  })
  async updateStack(
    @Param("stackId") stackId: string,
    @Body()
    body: Prisma.AwsResourceStackUpdateInput,
  ): Promise<AwsResourceStack> {
    return await this.prisma.awsResourceStack.update({
      where: { id: stackId },
      data: body,
    });
  }

  @Delete(":stackId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async deleteStack(
    @Param("stackId")
    stackId: string,
  ): Promise<AwsResourceStack> {
    // [step 1] Get the infrastructure stack.
    const stack = await this.prisma.awsResourceStack.findUniqueOrThrow({
      where: { id: stackId },
    });

    if (stack.state !== AwsResourceStackState.PENDING && stack.state !== AwsResourceStackState.DESTROY_SUCCEEDED) {
      throw new BadRequestException(
        "The stack record can not be deleted because the infrastructure resource is still there.",
      );
    }

    // [step 2] Delete the stack record on database.
    return await this.prisma.awsResourceStack.delete({ where: { id: stackId } });
  }

  //* Create resources
  @Post(":stackId/create-resources")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsResourceStack)
  @ApiCreatedResponse()
  async createResources(
    @Param("stackId")
    stackId: string,
  ): Promise<AwsResourceStack> {
    return await this.cloudformationService.createStack(stackId);
  }

  //* Destroy resources
  @Post(":stackId/destroy-resources")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsResourceStack)
  @ApiOkResponse()
  async destroyResources(
    @Param("stackId")
    stackId: string,
  ): Promise<AwsResourceStack> {
    return await this.cloudformationService.destroyStack(stackId);
  }

  /* End */
}
