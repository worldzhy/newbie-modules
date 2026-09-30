import {Controller, Get, Param, Post} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {DepScanService} from './dep-scan.service';
import {DepScanProjectReportResponseDto, DepScanScanStartResponseDto} from './dep-scan.dto';

@ApiTags('Dep Scan')
@ApiBearerAuth()
@Controller('dep-scan')
export class DepScanController {
  constructor(private readonly depScanService: DepScanService) {}

  @Get('projects/:projectId/report')
  @ApiOperation({summary: 'Get dependency vulnerability scan status and open findings for every application of a project'})
  @ApiResponse({status: 200, type: DepScanProjectReportResponseDto})
  async getProjectReport(@Param('projectId') projectId: string): Promise<DepScanProjectReportResponseDto> {
    return (await this.depScanService.getProjectReport(projectId)) as DepScanProjectReportResponseDto;
  }

  @Post('applications/:applicationId/scan')
  @ApiOperation({summary: 'Start a new dependency vulnerability scan for an application'})
  @ApiResponse({status: 200, type: DepScanScanStartResponseDto})
  async startApplicationScan(@Param('applicationId') applicationId: string): Promise<DepScanScanStartResponseDto> {
    return (await this.depScanService.startApplicationScan(applicationId)) as DepScanScanStartResponseDto;
  }
}
