import {Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query} from '@nestjs/common';
import {ApiHeader, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {BackendMonitorService} from './backend-monitor.service';
import {
  BackendMonitorErrorLogListResponseDto,
  BackendMonitorRequestLogListResponseDto,
  CreateBackendMonitorErrorReportDto,
  CreateBackendMonitorReportDto,
  ListBackendMonitorErrorLogsDto,
  ListBackendMonitorRequestLogsDto,
} from './backend-monitor.dto';
import {NoGuard} from '@microservices/account/security/passport/public/public.decorator';

@ApiTags('Backend Monitor')
@Controller('backend-monitor')
export class BackendMonitorController {
  constructor(private readonly backendMonitorService: BackendMonitorService) {}

  /**
   * Receives a single request-processing metric report from an application.
   * Authentication is performed via the X-Application-Token header which must
   * match the reportToken stored on the Application record in the database.
   *
   * This endpoint intentionally does NOT require user-level JWT authentication
   * so that backend services can call it without managing user sessions.
   */
  @ApiOperation({summary: 'Report a backend request metric'})
  @ApiHeader({
    name: 'X-Application-Token',
    description: 'The unique report token of the application (Application.reportToken)',
    required: true,
  })
  @ApiResponse({status: 204, description: 'Report accepted.'})
  @ApiResponse({status: 401, description: 'Invalid or missing application token.'})
  @HttpCode(HttpStatus.NO_CONTENT)
  @NoGuard()
  @Post('report')
  async createReport(
    @Headers('x-application-token') reportToken: string,
    @Body() body: CreateBackendMonitorReportDto
  ): Promise<void> {
    await this.backendMonitorService.createReport(reportToken, body);
  }

  /**
   * Receives an error/exception report from an application.
   * Authentication is performed via the X-Application-Token header which must
   * match the reportToken stored on the Application record in the database.
   */
  @ApiOperation({summary: 'Report a backend error/exception'})
  @ApiHeader({
    name: 'X-Application-Token',
    description: 'The unique report token of the application (Application.reportToken)',
    required: true,
  })
  @ApiResponse({status: 204, description: 'Error report accepted.'})
  @ApiResponse({status: 401, description: 'Invalid or missing application token.'})
  @HttpCode(HttpStatus.NO_CONTENT)
  @NoGuard()
  @Post('report-error')
  async createErrorReport(
    @Headers('x-application-token') reportToken: string,
    @Body() body: CreateBackendMonitorErrorReportDto
  ): Promise<void> {
    await this.backendMonitorService.createErrorReport(reportToken, body);
  }

  /**
   * Returns paginated request logs for the specified application token.
   * Supports keyword search on path and sorting on multiple fields.
   */
  @ApiOperation({summary: 'List backend request logs for an application'})
  @ApiResponse({
    status: 200,
    description: 'Paginated list of request logs.',
    type: BackendMonitorRequestLogListResponseDto,
  })
  @Get('request-logs')
  async listRequestLogs(@Query() query: ListBackendMonitorRequestLogsDto): Promise<{records: object[]; total: number}> {
    return await this.backendMonitorService.listRequestLogs(query);
  }

  /**
   * Returns paginated error logs for the specified application token.
   * Supports keyword search on message/path and sorting on multiple fields.
   */
  @ApiOperation({summary: 'List backend error logs for an application'})
  @ApiResponse({status: 200, description: 'Paginated list of error logs.', type: BackendMonitorErrorLogListResponseDto})
  @Get('error-logs')
  async listErrorLogs(@Query() query: ListBackendMonitorErrorLogsDto): Promise<{records: object[]; total: number}> {
    return await this.backendMonitorService.listErrorLogs(query);
  }
}
