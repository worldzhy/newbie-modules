import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AwsAuditService } from "./aws-audit.service";
import { AwsAuditReportResponseDto, AwsAuditScanStartResponseDto, GetAwsAuditReportRequestDto } from "./aws-audit.dto";

@ApiTags("AWS Audit")
@ApiBearerAuth()
@Controller("aws-audit/projects")
export class AwsAuditController {
  constructor(private readonly awsAuditService: AwsAuditService) {}

  @Get(":projectId/report")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.AwsAuditScan)
  @ApiOperation({ summary: "Get the latest AWS security audit report and scan history for a project" })
  @ApiResponse({ status: 200, type: AwsAuditReportResponseDto })
  async getProjectReport(
    @Param("projectId") projectId: string,
    @Query() query: GetAwsAuditReportRequestDto,
  ): Promise<AwsAuditReportResponseDto> {
    return (await this.awsAuditService.getProjectAuditReport(projectId, {
      detail: query.detail !== "false",
    })) as AwsAuditReportResponseDto;
  }

  @Post(":projectId/scan")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.AwsAuditScan)
  @ApiOperation({ summary: "Start a new AWS security audit scan for a project" })
  @ApiResponse({ status: 200, type: AwsAuditScanStartResponseDto })
  async startProjectScan(@Param("projectId") projectId: string): Promise<AwsAuditScanStartResponseDto> {
    return (await this.awsAuditService.startProjectAuditScan(projectId)) as AwsAuditScanStartResponseDto;
  }
}
