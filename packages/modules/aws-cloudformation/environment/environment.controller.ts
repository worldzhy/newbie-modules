import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AwsEnvironment, PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsEnvironmentService } from "@modules/aws-cloudformation/environment/environment.service";

/** An AWS environment row without the (encrypted-at-rest) secret access key. */
type PublicAwsEnvironment = Omit<AwsEnvironment, "awsSecretAccessKey">;

@ApiTags("AWS Environment")
@ApiBearerAuth()
@Controller("aws-environments")
export class AwsEnvironmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly awsEnvironmentService: AwsEnvironmentService,
  ) {}

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsEnvironment)
  @ApiCreatedResponse()
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: "1. Create",
        value: {
          name: "Aircruiser Prod",
          awsAccessKeyId: "",
          awsSecretAccessKey: "",
          awsRegion: "",
        },
      },
    },
  })
  async createEnvironment(
    @Body()
    body: Prisma.AwsEnvironmentUncheckedCreateInput,
  ): Promise<PublicAwsEnvironment> {
    // [step 1] Guard statement.
    if (!body.name) {
      throw new BadRequestException("Invalid project environment name in the request body.");
    }

    // [step 2] Create project.
    return this.withoutSecret(await this.awsEnvironmentService.create({ data: body }));
  }

  @Get(":environmentId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  async getEnvironment(@Param("environmentId") environmentId: string): Promise<PublicAwsEnvironment> {
    return this.withoutSecret(
      await this.prisma.awsEnvironment.findUniqueOrThrow({
        where: { id: environmentId },
      }),
    );
  }

  @Patch(":environmentId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  @ApiBody({
    description: "Update environment variables.",
    examples: {
      a: {
        summary: "1. Without AWS profile",
        value: {
          awsAccountId: "929553487761",
          awsAccessKeyId: "fakeAKIXXXXXQB3I56H72",
          awsSecretAccessKey: "fakeNyXXXXXXXXXrBJk7LUEhXBqHKxG4PiCJ6cQ",
          awsRegion: "us-east-1",
        },
      },
    },
  })
  async updateEnvironment(
    @Param("environmentId") environmentId: string,
    @Body() body: Prisma.AwsEnvironmentUpdateInput,
  ): Promise<PublicAwsEnvironment> {
    return this.withoutSecret(
      await this.awsEnvironmentService.update({
        where: { id: environmentId },
        data: body,
      }),
    );
  }

  @Delete(":environmentId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsEnvironment)
  @ApiOkResponse()
  async deleteEnvironment(@Param("environmentId") environmentId: string): Promise<PublicAwsEnvironment> {
    return this.withoutSecret(
      await this.prisma.awsEnvironment.delete({
        where: { id: environmentId },
      }),
    );
  }

  /**
   * The secret access key is encrypted at rest but still recoverable; it must
   * never leave the API. Every response route projects through this helper.
   */
  private withoutSecret(environment: AwsEnvironment): PublicAwsEnvironment {
    const safe = { ...environment } as Partial<AwsEnvironment>;
    delete safe.awsSecretAccessKey;
    return safe as PublicAwsEnvironment;
  }

  /* End */
}
