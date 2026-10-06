import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DependencyScanService } from "./dependency-scan.service";
import { DependencyScanProjectReportResponseDto, DependencyScanScanStartResponseDto } from "./dependency-scan.dto";

@ApiTags("Dependency Scan")
@ApiBearerAuth()
@Controller("dependency-scan")
export class DependencyScanController {
  constructor(private readonly dependencyScanService: DependencyScanService) {}

  @Get("projects/:projectId/report")
  @ApiOperation({
    summary: "Get dependency vulnerability scan status and open findings for every application of a project",
  })
  @ApiResponse({ status: 200, type: DependencyScanProjectReportResponseDto })
  async getProjectReport(@Param("projectId") projectId: string): Promise<DependencyScanProjectReportResponseDto> {
    return (await this.dependencyScanService.getProjectReport(projectId)) as DependencyScanProjectReportResponseDto;
  }

  @Post("applications/:applicationId/scan")
  @ApiOperation({ summary: "Start a new dependency vulnerability scan for an application" })
  @ApiResponse({ status: 200, type: DependencyScanScanStartResponseDto })
  async startApplicationScan(
    @Param("applicationId") applicationId: string,
  ): Promise<DependencyScanScanStartResponseDto> {
    return (await this.dependencyScanService.startApplicationScan(applicationId)) as DependencyScanScanStartResponseDto;
  }
}
