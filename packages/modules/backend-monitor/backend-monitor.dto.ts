import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * Maximum number of events accepted per array in a single ingest batch.
 * Beyond this the client must split the batch; the server responds 413.
 */
export const INGEST_BATCH_LIMIT = 500;

/**
 * One HTTP request metric reported by a backend application's monitor probe.
 * Deployment dimensions (env/instanceId/appVersion) are batch-level fields,
 * they are intentionally not accepted per row.
 */
export class BackendMonitorRequestEventDto {
  @ApiProperty({
    description:
      "Client-generated correlation id, shared with matching error events",
    maxLength: 128,
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  requestId: string;

  @ApiPropertyOptional({
    description: "Route template, e.g. /users/:id; empty when no route matched",
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  route?: string;

  @ApiProperty({
    description: "Pathname without query string",
    example: "/api/users",
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2048)
  path: string;

  @ApiProperty({ description: "HTTP method in upper-case", example: "GET" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(10)
  method: string;

  @ApiProperty({ description: "HTTP response status code", example: 200 })
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode: number;

  @ApiProperty({
    description: "ISO 8601 timestamp of request arrival",
    example: "2026-09-26T08:00:00.000Z",
  })
  @IsNotEmpty()
  @IsDateString()
  requestAt: string;

  @ApiProperty({
    description: "ISO 8601 timestamp of response completion",
    example: "2026-09-26T08:00:00.123Z",
  })
  @IsNotEmpty()
  @IsDateString()
  responseAt: string;

  @ApiPropertyOptional({ description: "Client IP address" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @ApiPropertyOptional({ description: "Raw User-Agent header" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

/**
 * One unhandled error/exception reported by a backend application's probe.
 * requestId links it to the request row when the error happened during a
 * request; it is empty for process-level errors (unhandledRejection etc.).
 */
export class BackendMonitorErrorEventDto {
  @ApiPropertyOptional({
    description: "Correlation id of the enclosing request, if any",
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  requestId?: string;

  @ApiProperty({ description: "Error type / class name", example: "TypeError" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  type: string;

  @ApiProperty({ description: "Error message" })
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  message: string;

  @ApiPropertyOptional({ description: "Full stack trace" })
  @IsOptional()
  @IsString()
  @MaxLength(16000)
  stack?: string;

  @ApiPropertyOptional({
    description: "Route template where the error occurred",
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  route?: string;

  @ApiPropertyOptional({ description: "Pathname without query string" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  path?: string;

  @ApiPropertyOptional({ description: "HTTP method in upper-case" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  method?: string;

  @ApiPropertyOptional({
    description: "HTTP status code, 0 when not applicable",
    example: 500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({ description: "Client IP address" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

  @ApiPropertyOptional({ description: "Raw User-Agent header" })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;

  @ApiProperty({ description: "ISO 8601 timestamp of when the error occurred" })
  @IsNotEmpty()
  @IsDateString()
  occurredAt: string;
}

/**
 * Batched ingestion payload. Deployment dimensions are set once for the whole
 * batch (a single process reports one env/version/instance) and copied onto
 * every stored row by the server.
 */
export class CreateBackendMonitorIngestDto {
  @ApiPropertyOptional({
    description: "Deployment environment, e.g. production / staging",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  env?: string;

  @ApiPropertyOptional({
    description: "Reporting instance id (hostname / pod name)",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  instanceId?: string;

  @ApiPropertyOptional({ description: "Application version", maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appVersion?: string;

  @ApiPropertyOptional({
    type: [BackendMonitorRequestEventDto],
    description: "Request metric events (max 500)",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackendMonitorRequestEventDto)
  requests?: BackendMonitorRequestEventDto[];

  @ApiPropertyOptional({
    type: [BackendMonitorErrorEventDto],
    description: "Error events (max 500)",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BackendMonitorErrorEventDto)
  errors?: BackendMonitorErrorEventDto[];
}

/** Query parameters for listing backend request logs. */
export class ListBackendMonitorRequestLogsDto {
  @ApiProperty({ type: String, description: "Application ID (UUID)" })
  @IsNotEmpty()
  @IsUUID()
  applicationId: string;

  @ApiProperty({ type: Number, description: "Page number, starts from 0" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ type: Number, description: "Items per page, capped at 100" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;

  @ApiPropertyOptional({ type: String, description: "Search by path keyword" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @ApiPropertyOptional({
    description:
      "Sort field: path | method | status_code | duration_ms | request_at",
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ description: "Sort direction: asc | desc" })
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc";
}

/** Query parameters for listing backend error logs. */
export class ListBackendMonitorErrorLogsDto {
  @ApiProperty({ type: String, description: "Application ID (UUID)" })
  @IsNotEmpty()
  @IsUUID()
  applicationId: string;

  @ApiProperty({ type: Number, description: "Page number, starts from 0" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ type: Number, description: "Items per page, capped at 100" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  pageSize?: number;

  @ApiPropertyOptional({
    type: String,
    description: "Search by message or path keyword",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @ApiPropertyOptional({
    description:
      "Sort field: type | message | path | status_code | occurred_at",
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ description: "Sort direction: asc | desc" })
  @IsOptional()
  @IsString()
  sortOrder?: "asc" | "desc";
}

/** One row of application_request_logs (ClickHouse snake_case shape). */
export class BackendMonitorRequestLogResponseDto {
  application_id: string;
  request_id: string;
  route: string;
  path: string;
  method: string;
  status_code: number;
  request_at: string;
  response_at: string;
  duration_ms: number;
  env: string;
  instance_id: string;
  app_version: string;
  ip: string;
  user_agent: string;
  ingested_at: string;
}

/** One row of application_error_logs (ClickHouse snake_case shape). */
export class BackendMonitorErrorLogResponseDto {
  application_id: string;
  request_id: string;
  fingerprint: string;
  type: string;
  message: string;
  stack: string;
  route: string;
  path: string;
  method: string;
  status_code: number;
  env: string;
  instance_id: string;
  app_version: string;
  ip: string;
  user_agent: string;
  occurred_at: string;
  ingested_at: string;
}

export class BackendMonitorRequestLogListResponseDto {
  @ApiProperty({ type: [BackendMonitorRequestLogResponseDto] })
  records: BackendMonitorRequestLogResponseDto[];

  @ApiProperty({ type: Number })
  total: number;
}

export class BackendMonitorErrorLogListResponseDto {
  @ApiProperty({ type: [BackendMonitorErrorLogResponseDto] })
  records: BackendMonitorErrorLogResponseDto[];

  @ApiProperty({ type: Number })
  total: number;
}
