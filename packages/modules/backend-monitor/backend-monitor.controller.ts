import {Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Query} from '@nestjs/common';
import {ApiHeader, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {NoGuard} from '@modules/account/security/passport/public/public.decorator';
import {BackendMonitorService} from './backend-monitor.service';
import {
  BackendMonitorErrorLogListResponseDto,
  BackendMonitorRequestLogListResponseDto,
  CreateBackendMonitorIngestDto,
  ListBackendMonitorErrorLogsDto,
  ListBackendMonitorRequestLogsDto,
} from './backend-monitor.dto';

@ApiTags('Backend Monitor')
@Controller('backend-monitor')
export class BackendMonitorController {
  constructor(private readonly backendMonitorService: BackendMonitorService) {}

  /**
   * Batched ingestion endpoint for backend applications.
   * Open route (no user JWT); authentication is the SERVER_MONITOR agent
   * token presented via X-Application-Token. One call carries request metrics
   * and/or errors, enabling one auth lookup and at most one insert per table.
   */
  @ApiOperation({summary: 'Ingest a batch of backend request/error events'})
  @ApiHeader({
    name: 'X-Application-Token',
    description: 'The secret token of the SERVER_MONITOR agent (Agent.token)',
    required: true,
  })
  @ApiResponse({status: 204, description: 'Batch accepted.'})
  @ApiResponse({status: 400, description: 'Empty batch or invalid event payload.'})
  @ApiResponse({status: 401, description: 'Invalid or missing application token.'})
  @ApiResponse({status: 413, description: 'An event array exceeds the batch limit.'})
  @HttpCode(HttpStatus.NO_CONTENT)
  @NoGuard()
  @Post('ingest')
  async ingest(
    @Headers('x-application-token') reportToken: string,
    @Body() body: CreateBackendMonitorIngestDto
  ): Promise<void> {
    await this.backendMonitorService.ingest(reportToken, body);
  }

  /**
   * Paginated request logs for one application. Backs the monitoring UI list;
   * keeps the legacy query contract (applicationId/page/pageSize/keyword/
   * sortField/sortOrder) and snake_case row shape.
   */
  @ApiOperation({summary: 'List backend request logs for an application'})
  @ApiResponse({status: 200, type: BackendMonitorRequestLogListResponseDto})
  @Get('request-logs')
  async listRequestLogs(@Query() query: ListBackendMonitorRequestLogsDto) {
    return await this.backendMonitorService.listRequestLogs(query);
  }

  /** Paginated error logs for one application. */
  @ApiOperation({summary: 'List backend error logs for an application'})
  @ApiResponse({status: 200, type: BackendMonitorErrorLogListResponseDto})
  @Get('error-logs')
  async listErrorLogs(@Query() query: ListBackendMonitorErrorLogsDto) {
    return await this.backendMonitorService.listErrorLogs(query);
  }
}
