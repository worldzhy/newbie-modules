import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min} from 'class-validator';
import {Type} from 'class-transformer';

/**
 * Request body for the backend monitor request report endpoint.
 * The X-Application-Token header is validated separately in the controller.
 */
export class CreateBackendMonitorReportDto {
  @ApiProperty({
    type: String,
    description: 'The HTTP request path (e.g. /api/users)',
    example: '/api/users',
  })
  @IsNotEmpty()
  @IsString()
  path: string;

  @ApiProperty({
    type: String,
    description: 'The HTTP method in upper-case (e.g. GET, POST)',
    example: 'GET',
  })
  @IsNotEmpty()
  @IsString()
  method: string;

  @ApiProperty({
    type: Number,
    description: 'The HTTP response status code',
    example: 200,
  })
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode: number;

  @ApiProperty({
    type: String,
    description: 'ISO 8601 timestamp of when the request arrived at the server',
    example: '2026-03-26T08:00:00.000Z',
  })
  @IsNotEmpty()
  @IsDateString()
  requestAt: string;

  @ApiProperty({
    type: String,
    description: 'ISO 8601 timestamp of when the response was sent back to the client',
    example: '2026-03-26T08:00:00.123Z',
  })
  @IsNotEmpty()
  @IsDateString()
  responseAt: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Client IP address',
    example: '203.0.113.42',
  })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Raw User-Agent string from the request header',
    example: 'Mozilla/5.0',
  })
  @IsOptional()
  @IsString()
  userAgent?: string;
}

/**
 * Request body for the backend monitor error report endpoint.
 * The X-Application-Token header is validated separately in the controller.
 */
export class CreateBackendMonitorErrorReportDto {
  @ApiProperty({
    type: String,
    description: 'Error type / category (e.g. UnhandledError, UnhandledRejection, HttpError)',
    example: 'UnhandledError',
  })
  @IsNotEmpty()
  @IsString()
  type: string;

  @ApiProperty({
    type: String,
    description: 'The error message string',
    example: 'Cannot read property "id" of undefined',
  })
  @IsNotEmpty()
  @IsString()
  message: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Full stack trace string',
    example: 'Error: Cannot read property...\n    at handler (/app/src/foo.ts:12:5)',
  })
  @IsOptional()
  @IsString()
  stack?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'HTTP request path where the error occurred',
    example: '/api/users',
  })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'HTTP method in upper-case',
    example: 'GET',
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({
    type: Number,
    description: 'HTTP response status code, 0 if not applicable',
    example: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'Client IP address',
    example: '203.0.113.42',
  })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Raw User-Agent string from the request header',
    example: 'Mozilla/5.0',
  })
  @IsOptional()
  @IsString()
  userAgent?: string;

  @ApiProperty({
    type: String,
    description: 'ISO 8601 timestamp of when the error occurred',
    example: '2026-04-10T08:00:00.000Z',
  })
  @IsNotEmpty()
  @IsDateString()
  occurredAt: string;
}

/**
 * Query parameters for listing backend monitor request logs.
 */
export class ListBackendMonitorRequestLogsDto {
  @ApiProperty({type: String, description: 'Application ID (UUID)'})
  @IsNotEmpty()
  @IsString()
  applicationId: string;

  @ApiProperty({type: Number, description: 'Page number, starts from 0'})
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  page: number;

  @ApiProperty({type: Number, description: 'Number of items per page'})
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  pageSize: number;

  @ApiPropertyOptional({type: String, description: 'Search by path keyword'})
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Sort field: path | method | status_code | duration_ms | request_at',
    example: 'request_at',
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Sort direction: asc | desc',
    example: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

/**
 * Query parameters for listing backend monitor error logs.
 */
export class ListBackendMonitorErrorLogsDto {
  @ApiProperty({type: String, description: 'Application ID (UUID)'})
  @IsNotEmpty()
  @IsString()
  applicationId: string;

  @ApiProperty({type: Number, description: 'Page number, starts from 0'})
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  page: number;

  @ApiProperty({type: Number, description: 'Number of items per page'})
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  pageSize: number;

  @ApiPropertyOptional({type: String, description: 'Search by message or path keyword'})
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Sort field: type | message | path | status_code | occurred_at',
    example: 'occurred_at',
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Sort direction: asc | desc',
    example: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

/**
 * Response DTO for a single backend request log row (ClickHouse application_request_logs).
 */
export class BackendMonitorRequestLogResponseDto {
  @ApiProperty({type: String, description: 'Application ID (UUID)'})
  application_id: string;

  @ApiProperty({type: String, description: 'The HTTP request path'})
  path: string;

  @ApiProperty({type: String, description: 'The HTTP method in upper-case'})
  method: string;

  @ApiProperty({type: Number, description: 'The HTTP response status code'})
  status_code: number;

  @ApiProperty({type: String, description: 'ISO 8601 timestamp of when the request arrived'})
  request_at: string;

  @ApiProperty({type: String, description: 'ISO 8601 timestamp of when the response was sent'})
  response_at: string;

  @ApiProperty({type: Number, description: 'Request duration in milliseconds'})
  duration_ms: number;

  @ApiPropertyOptional({type: String, description: 'Client IP address'})
  ip?: string | null;

  @ApiPropertyOptional({type: String, description: 'Raw User-Agent string'})
  user_agent?: string | null;

  @ApiProperty({type: String, description: 'ISO 8601 timestamp of when the row was ingested'})
  created_at: string;
}

/**
 * Response DTO for a single backend error log row (ClickHouse application_error_logs).
 */
export class BackendMonitorErrorLogResponseDto {
  @ApiProperty({type: String, description: 'Application ID (UUID)'})
  application_id: string;

  @ApiProperty({type: String, description: 'Error type / category'})
  type: string;

  @ApiProperty({type: String, description: 'The error message string'})
  message: string;

  @ApiPropertyOptional({type: String, description: 'Full stack trace string'})
  stack?: string | null;

  @ApiPropertyOptional({type: String, description: 'HTTP request path where the error occurred'})
  path?: string | null;

  @ApiPropertyOptional({type: String, description: 'HTTP method in upper-case'})
  method?: string | null;

  @ApiPropertyOptional({type: Number, description: 'HTTP response status code, 0 if not applicable'})
  status_code?: number | null;

  @ApiPropertyOptional({type: String, description: 'Client IP address'})
  ip?: string | null;

  @ApiPropertyOptional({type: String, description: 'Raw User-Agent string'})
  user_agent?: string | null;

  @ApiProperty({type: String, description: 'ISO 8601 timestamp of when the error occurred'})
  occurred_at: string;

  @ApiProperty({type: String, description: 'ISO 8601 timestamp of when the row was ingested'})
  created_at: string;
}

/**
 * Paginated response for backend request logs.
 */
export class BackendMonitorRequestLogListResponseDto {
  @ApiProperty({type: BackendMonitorRequestLogResponseDto, isArray: true})
  records: BackendMonitorRequestLogResponseDto[];

  @ApiProperty({type: Number, description: 'Total count of rows matching the query'})
  total: number;
}

/**
 * Paginated response for backend error logs.
 */
export class BackendMonitorErrorLogListResponseDto {
  @ApiProperty({type: BackendMonitorErrorLogResponseDto, isArray: true})
  records: BackendMonitorErrorLogResponseDto[];

  @ApiProperty({type: Number, description: 'Total count of rows matching the query'})
  total: number;
}
