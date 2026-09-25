import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {AgentStatus, AgentType} from '@generated/prisma/enums';
import {ClickhouseService} from '@modules/clickhouse/clickhouse.service';
import {
  CreateBackendMonitorErrorReportDto,
  CreateBackendMonitorReportDto,
  ListBackendMonitorErrorLogsDto,
  ListBackendMonitorRequestLogsDto,
} from './backend-monitor.dto';

/** Allowed sort fields for request logs to prevent SQL injection. */
const ALLOWED_REQUEST_SORT_FIELDS = new Set(['path', 'method', 'status_code', 'duration_ms', 'request_at']);

/** Allowed sort fields for error logs to prevent SQL injection. */
const ALLOWED_ERROR_SORT_FIELDS = new Set(['type', 'message', 'path', 'status_code', 'occurred_at']);

/** Formats a JS Date to a ClickHouse DateTime64 string (UTC). */
function toClickHouseDate(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

@Injectable()
export class BackendMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickhouseService
  ) {}

  /**
   * Resolves the owning application ID from a SERVER_MONITOR agent token.
   * A report is accepted when the token matches an agent that is not DISABLED
   * (a PENDING agent is activated by its first successful report).
   * Throws UnauthorizedException when the token is invalid or revoked.
   */
  private async resolveApplicationId(reportToken: string): Promise<string> {
    const agent = await this.prisma.agent.findUnique({
      where: {token: reportToken},
    });
    if (!agent || agent.type !== AgentType.SERVER_MONITOR || agent.status === AgentStatus.DISABLED) {
      throw new UnauthorizedException('Invalid application report token.');
    }

    // Anti-regression touch: never let an older concurrent report move
    // lastSeenAt backwards; also flips PENDING -> ACTIVE on first contact.
    const now = new Date();
    await this.prisma.$executeRaw`
      UPDATE "application"."Agent"
      SET "lastSeenAt" = ${now},
          "status" = CASE WHEN "status" = 'PENDING' THEN 'ACTIVE'::"application"."AgentStatus" ELSE "status" END
      WHERE "id" = ${agent.id}::uuid
        AND ("lastSeenAt" IS NULL OR "lastSeenAt" < ${now})
    `;

    return agent.applicationId;
  }

  /**
   * Validates the report token against the database, computes the request
   * duration, and inserts a log entry into ClickHouse.
   *
   * @param reportToken - Value from the X-Application-Token request header.
   * @param body - The report payload sent by the application.
   * @throws UnauthorizedException when the token does not match any Application.
   */
  async createReport(reportToken: string, body: CreateBackendMonitorReportDto): Promise<void> {
    const applicationId = await this.resolveApplicationId(reportToken);

    const requestAt = new Date(body.requestAt);
    const responseAt = new Date(body.responseAt);

    // Compute duration server-side to avoid relying on client-provided values.
    const durationMs = Math.max(0, responseAt.getTime() - requestAt.getTime());

    await this.clickhouse.insert({
      table: 'application_request_logs',
      values: [
        {
          application_id: applicationId,
          path: body.path,
          method: body.method.toUpperCase(),
          status_code: body.statusCode,
          request_at: toClickHouseDate(requestAt),
          response_at: toClickHouseDate(responseAt),
          duration_ms: durationMs,
          ip: body.ip ?? '',
          user_agent: body.userAgent ?? '',
        },
      ],
      format: 'JSONEachRow',
    });
  }

  /**
   * Validates the report token and inserts an error log entry into ClickHouse.
   *
   * @param reportToken - Value from the X-Application-Token request header.
   * @param body - The error report payload sent by the application.
   * @throws UnauthorizedException when the token does not match any Application.
   */
  async createErrorReport(reportToken: string, body: CreateBackendMonitorErrorReportDto): Promise<void> {
    const applicationId = await this.resolveApplicationId(reportToken);

    const occurredAt = new Date(body.occurredAt);

    await this.clickhouse.insert({
      table: 'application_error_logs',
      values: [
        {
          application_id: applicationId,
          type: body.type,
          message: body.message,
          stack: body.stack ?? '',
          path: body.path ?? '',
          method: body.method ? body.method.toUpperCase() : '',
          status_code: body.statusCode ?? 0,
          ip: body.ip ?? '',
          user_agent: body.userAgent ?? '',
          occurred_at: toClickHouseDate(occurredAt),
        },
      ],
      format: 'JSONEachRow',
    });
  }

  /**
   * Queries paginated request logs from ClickHouse for a given application ID.
   * Supports keyword filtering on path and sorting on any allowed field.
   *
   * @param query - List query parameters.
   */
  async listRequestLogs(query: ListBackendMonitorRequestLogsDto): Promise<{records: any[]; total: number}> {
    const {applicationId, page, pageSize, keyword, sortField, sortOrder} = query;

    // Sanitise sort parameters to prevent injection.
    const safeField = sortField && ALLOWED_REQUEST_SORT_FIELDS.has(sortField) ? sortField : 'request_at';
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const offset = page * pageSize;

    // Build optional keyword WHERE clause.
    const keywordClause = keyword ? `AND path ILIKE '%${keyword.replace(/'/g, "''")}%'` : '';

    // Filter by application_id (stable UUID, unaffected by token rotation).
    const baseWhere = `WHERE application_id = '${applicationId.replace(/'/g, "''")}' ${keywordClause}`;

    // Query for total count.
    const countResult = await this.clickhouse.query({
      query: `SELECT count() AS total FROM application_request_logs ${baseWhere}`,
      format: 'JSONEachRow',
    });
    const countRows = (await countResult.json()) as Array<{total: string}>;
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    // Query for paginated data.
    const dataResult = await this.clickhouse.query({
      query: `
        SELECT
          application_id,
          path,
          method,
          status_code,
          request_at,
          response_at,
          duration_ms,
          ip,
          user_agent,
          created_at
        FROM application_request_logs
        ${baseWhere}
        ORDER BY ${safeField} ${safeOrder}
        LIMIT ${pageSize}
        OFFSET ${offset}
      `,
      format: 'JSONEachRow',
    });
    const records = (await dataResult.json()) as any[];

    return {records, total};
  }

  /**
   * Queries paginated error logs from ClickHouse for a given application ID.
   * Supports keyword filtering on message and path, and sorting on any allowed field.
   *
   * @param query - List query parameters.
   */
  async listErrorLogs(query: ListBackendMonitorErrorLogsDto): Promise<{records: any[]; total: number}> {
    const {applicationId, page, pageSize, keyword, sortField, sortOrder} = query;

    const safeField = sortField && ALLOWED_ERROR_SORT_FIELDS.has(sortField) ? sortField : 'occurred_at';
    const safeOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';
    const offset = page * pageSize;

    const keywordClause = keyword
      ? `AND (message ILIKE '%${keyword.replace(/'/g, "''")}%' OR path ILIKE '%${keyword.replace(/'/g, "''")}%')`
      : '';

    // Filter by application_id (stable UUID, unaffected by token rotation).
    const baseWhere = `WHERE application_id = '${applicationId.replace(/'/g, "''")}' ${keywordClause}`;

    const countResult = await this.clickhouse.query({
      query: `SELECT count() AS total FROM application_error_logs ${baseWhere}`,
      format: 'JSONEachRow',
    });
    const countRows = (await countResult.json()) as Array<{total: string}>;
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    const dataResult = await this.clickhouse.query({
      query: `
        SELECT
          application_id,
          type,
          message,
          stack,
          path,
          method,
          status_code,
          ip,
          user_agent,
          occurred_at,
          created_at
        FROM application_error_logs
        ${baseWhere}
        ORDER BY ${safeField} ${safeOrder}
        LIMIT ${pageSize}
        OFFSET ${offset}
      `,
      format: 'JSONEachRow',
    });
    const records = (await dataResult.json()) as any[];

    return {records, total};
  }
}
