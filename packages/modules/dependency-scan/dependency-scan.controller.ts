import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { DependencyScanService } from "./dependency-scan.service";
import { DependencyScanProjectReportResponseDto, DependencyScanScanStartResponseDto } from "./dependency-scan.dto";

@ApiTags("Dependency Scan")
@ApiBearerAuth()
@Controller("dependency-scan")
export class DependencyScanController {
  constructor(private readonly dependencyScanService: DependencyScanService) {}

  @Get("projects/:projectId/report")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.DependencyScan, { scope: "project" })
  @ApiOperation({
    summary: "Get dependency vulnerability scan status and open findings for every application of a project",
  })
  @ApiResponse({ status: 200, type: DependencyScanProjectReportResponseDto })
  async getProjectReport(@Param("projectId") projectId: string): Promise<DependencyScanProjectReportResponseDto> {
    return (await this.dependencyScanService.getProjectReport(projectId)) as DependencyScanProjectReportResponseDto;
  }

  @Post("applications/:applicationId/scan")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.DependencyScan, { scope: "application" })
  @ApiOperation({ summary: "Start a new dependency vulnerability scan for an application" })
  @ApiResponse({ status: 200, type: DependencyScanScanStartResponseDto })
  async startApplicationScan(
    @Param("applicationId") applicationId: string,
  ): Promise<DependencyScanScanStartResponseDto> {
    return (await this.dependencyScanService.startApplicationScan(applicationId)) as DependencyScanScanStartResponseDto;
  }
}
