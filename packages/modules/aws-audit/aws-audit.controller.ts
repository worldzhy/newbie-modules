import {Controller, Get, Param, Post, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AwsAuditService} from './aws-audit.service';
import {AwsAuditReportResponseDto, AwsAuditScanStartResponseDto, GetAwsAuditReportDto} from './aws-audit.dto';

@ApiTags('AWS Audit')
@ApiBearerAuth()
@Controller('aws-audit/projects')
export class AwsAuditController {
  constructor(private readonly awsAuditService: AwsAuditService) {}

  @Get(':projectId/report')
  @ApiOperation({summary: 'Get the latest AWS security audit report and scan history for a project'})
  @ApiResponse({status: 200, type: AwsAuditReportResponseDto})
  async getProjectReport(
    @Param('projectId') projectId: string,
    @Query() query: GetAwsAuditReportDto
  ): Promise<AwsAuditReportResponseDto> {
    return (await this.awsAuditService.getProjectAuditReport(projectId, {
      detail: query.detail !== 'false',
    })) as AwsAuditReportResponseDto;
  }

  @Post(':projectId/scan')
  @ApiOperation({summary: 'Start a new AWS security audit scan for a project'})
  @ApiResponse({status: 200, type: AwsAuditScanStartResponseDto})
  async startProjectScan(@Param('projectId') projectId: string): Promise<AwsAuditScanStartResponseDto> {
    return (await this.awsAuditService.startProjectAuditScan(projectId)) as AwsAuditScanStartResponseDto;
  }
}
