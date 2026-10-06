import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AwsCredentialService } from "./aws-credential.service";
import {
  ProjectAwsCredentialResponseDto,
  UpsertProjectAwsCredentialDto,
  VerifyAwsCredentialResponseDto,
} from "./aws-credential.dto";

@ApiTags("AWS Credential")
@ApiBearerAuth()
@Controller("aws-credentials/projects")
export class AwsCredentialController {
  constructor(private readonly service: AwsCredentialService) {}

  @Get(":projectId")
  @ApiOperation({ summary: "Get the cross-account AWS role configured for a project" })
  @ApiResponse({ status: 200, type: ProjectAwsCredentialResponseDto })
  async getProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.getProjectCredential(projectId);
  }

  @Post(":projectId/bootstrap")
  @ApiOperation({
    summary: "Generate the per-project external ID used by the customer role trust policy",
  })
  @ApiResponse({ status: 200, type: ProjectAwsCredentialResponseDto })
  async bootstrapProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.bootstrapProjectCredential(projectId);
  }

  @Put(":projectId")
  @ApiOperation({ summary: "Save or update the cross-account role ARN for a project" })
  @ApiResponse({ status: 200, type: ProjectAwsCredentialResponseDto })
  async upsertProjectCredential(@Param("projectId") projectId: string, @Body() body: UpsertProjectAwsCredentialDto) {
    return await this.service.upsertProjectCredential(projectId, body);
  }

  @Post(":projectId/verify")
  @ApiOperation({ summary: "Verify the cross-account role via STS AssumeRole + GetCallerIdentity" })
  @ApiResponse({ status: 200, type: VerifyAwsCredentialResponseDto })
  async verifyProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.verifyProjectCredential(projectId);
  }

  @Post(":projectId/rotate-external-id")
  @ApiOperation({ summary: "Rotate the per-project external ID" })
  @ApiResponse({ status: 200, type: ProjectAwsCredentialResponseDto })
  async rotateExternalId(@Param("projectId") projectId: string) {
    return await this.service.rotateExternalId(projectId);
  }

  @Delete(":projectId")
  @ApiOperation({ summary: "Delete the cross-account AWS role configuration for a project" })
  @ApiResponse({ status: 200, type: ProjectAwsCredentialResponseDto })
  async deleteProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.deleteProjectCredential(projectId);
  }
}
