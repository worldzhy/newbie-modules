import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsCredentialsService } from "./aws-credentials.service";
import {
  AwsCrossAccountBindingResponseDto,
  UpsertAwsCrossAccountBindingDto,
  VerifyAwsCrossAccountBindingResponseDto,
} from "./aws-credentials.dto";

@ApiTags("AWS Credential")
@ApiBearerAuth()
@Controller("aws-credentials/projects")
export class AwsCredentialsController {
  constructor(private readonly service: AwsCredentialsService) {}

  @Get(":projectId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Get the cross-account AWS role configured for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async getProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.getProjectCredential(projectId);
  }

  @Post(":projectId/bootstrap")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({
    summary: "Generate the per-project external ID used by the customer role trust policy",
  })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async bootstrapProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.bootstrapProjectCredential(projectId);
  }

  @Put(":projectId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Save or update the cross-account role ARN for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async upsertProjectCredential(@Param("projectId") projectId: string, @Body() body: UpsertAwsCrossAccountBindingDto) {
    return await this.service.upsertProjectCredential(projectId, body);
  }

  @Post(":projectId/verify")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Verify the cross-account role via STS AssumeRole + GetCallerIdentity" })
  @ApiResponse({ status: 200, type: VerifyAwsCrossAccountBindingResponseDto })
  async verifyProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.verifyProjectCredential(projectId);
  }

  @Post(":projectId/rotate-external-id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Rotate the external ID of the binding for this host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async rotateExternalId(@Param("projectId") projectId: string) {
    return await this.service.rotateExternalId(projectId);
  }

  @Delete(":projectId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.AwsCrossAccountBinding)
  @ApiOperation({ summary: "Delete the cross-account AWS role configuration for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async deleteProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.deleteProjectCredential(projectId);
  }
}
