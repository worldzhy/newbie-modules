import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
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
  @ApiOperation({ summary: "Get the cross-account AWS role configured for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async getProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.getProjectCredential(projectId);
  }

  @Post(":projectId/bootstrap")
  @ApiOperation({
    summary: "Generate the per-project external ID used by the customer role trust policy",
  })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async bootstrapProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.bootstrapProjectCredential(projectId);
  }

  @Put(":projectId")
  @ApiOperation({ summary: "Save or update the cross-account role ARN for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async upsertProjectCredential(@Param("projectId") projectId: string, @Body() body: UpsertAwsCrossAccountBindingDto) {
    return await this.service.upsertProjectCredential(projectId, body);
  }

  @Post(":projectId/verify")
  @ApiOperation({ summary: "Verify the cross-account role via STS AssumeRole + GetCallerIdentity" })
  @ApiResponse({ status: 200, type: VerifyAwsCrossAccountBindingResponseDto })
  async verifyProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.verifyProjectCredential(projectId);
  }

  @Post(":projectId/rotate-external-id")
  @ApiOperation({ summary: "Rotate the external ID of the binding for this host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async rotateExternalId(@Param("projectId") projectId: string) {
    return await this.service.rotateExternalId(projectId);
  }

  @Delete(":projectId")
  @ApiOperation({ summary: "Delete the cross-account AWS role configuration for a host scope" })
  @ApiResponse({ status: 200, type: AwsCrossAccountBindingResponseDto })
  async deleteProjectCredential(@Param("projectId") projectId: string) {
    return await this.service.deleteProjectCredential(projectId);
  }
}
