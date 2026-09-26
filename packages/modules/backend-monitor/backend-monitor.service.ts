import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ClickhouseService } from "@modules/clickhouse/clickhouse.service";
import { AgentTokenResolver } from "./agent-token.resolver";
import { computeErrorFingerprint } from "./error-fingerprint.util";
import {
  BackendMonitorErrorEventDto,
  BackendMonitorRequestEventDto,
  CreateBackendMonitorIngestDto,
  INGEST_BATCH_LIMIT,
  ListBackendMonitorErrorLogsDto,
  ListBackendMonitorRequestLogsDto,
} from "./backend-monitor.dto";

/** Allowed sort fields for request logs (whitelist guards the ORDER BY clause). */
const ALLOWED_REQUEST_SORT_FIELDS = new Set([
  "path",
  "method",
  "status_code",
  "duration_ms",
  "request_at",
]);
/** Allowed sort fields for error logs. */
const ALLOWED_ERROR_SORT_FIELDS = new Set([
  "type",
  "message",
  "path",
  "status_code",
  "occurred_at",
]);

/** Accepted client-clock skew into the past. */
const MAX_PAST_SKEW_MS = 60 * 60 * 1000; // 1 hour
/** Accepted client-clock skew into the future. */
const MAX_FUTURE_SKEW_MS = 60 * 1000; // 1 minute

export interface RequestLogRow {
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
}

export interface ErrorLogRow {
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
}

/** Formats a JS Date to a ClickHouse DateTime64 string (UTC). */
function toClickHouseDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

@Injectable()
export class BackendMonitorService {
  constructor(
    private readonly clickhouse: ClickhouseService,
    private readonly agentTokenResolver: AgentTokenResolver,
  ) {}

  /**
   * Authenticates one batch and inserts its events into ClickHouse with at
   * most one multi-row insert per non-empty event array.
   */
  async ingest(
    reportToken: string | undefined,
    body: CreateBackendMonitorIngestDto,
  ): Promise<void> {
    const applicationId =
      await this.agentTokenResolver.resolveApplicationId(reportToken);

    const requests = body.requests ?? [];
    const errors = body.errors ?? [];
    if (requests.length === 0 && errors.length === 0) {
      throw new BadRequestException(
        'At least one of "requests" or "errors" must be non-empty.',
      );
    }
    if (
      requests.length > INGEST_BATCH_LIMIT ||
      errors.length > INGEST_BATCH_LIMIT
    ) {
      throw new PayloadTooLargeException(
        `Each event array must contain at most ${INGEST_BATCH_LIMIT} items.`,
      );
    }

    const env = body.env ?? "";
    const instanceId = body.instanceId ?? "";
    const appVersion = body.appVersion ?? "";

    if (requests.length > 0) {
      await this.clickhouse.insert({
        table: "application_request_logs",
        values: requests.map((event) =>
          this.toRequestRow(applicationId, event, env, instanceId, appVersion),
        ),
        format: "JSONEachRow",
      });
    }

    if (errors.length > 0) {
      await this.clickhouse.insert({
        table: "application_error_logs",
        values: errors.map((event) =>
          this.toErrorRow(applicationId, event, env, instanceId, appVersion),
        ),
        format: "JSONEachRow",
      });
    }
  }

  /**
   * Builds the stored request row. Duration is recomputed server-side; client
   * timestamps outside the accepted clock-skew window fall back to the receive
   * time so partitions are never polluted by bogus clocks.
   */
  private toRequestRow(
    applicationId: string,
    event: BackendMonitorRequestEventDto,
    env: string,
    instanceId: string,
    appVersion: string,
  ): RequestLogRow {
    const requestAt = new Date(event.requestAt);
    const responseAt = new Date(event.responseAt);
    const now = new Date();
    const valid =
      this.isTrustedTimestamp(requestAt, now) &&
      this.isTrustedTimestamp(responseAt, now);

    const safeRequestAt = valid ? requestAt : now;
    const safeResponseAt = valid ? responseAt : now;
    const durationMs = valid
      ? Math.max(0, safeResponseAt.getTime() - safeRequestAt.getTime())
      : 0;

    return {
      application_id: applicationId,
      request_id: event.requestId,
      route: event.route ?? "",
      path: event.path,
      method: event.method.toUpperCase(),
      status_code: event.statusCode,
      request_at: toClickHouseDate(safeRequestAt),
      response_at: toClickHouseDate(safeResponseAt),
      duration_ms: durationMs,
      env,
      instance_id: instanceId,
      app_version: appVersion,
      ip: event.ip ?? "",
      user_agent: event.userAgent ?? "",
    };
  }

  /** Builds the stored error row, including the server-computed fingerprint. */
  private toErrorRow(
    applicationId: string,
    event: BackendMonitorErrorEventDto,
    env: string,
    instanceId: string,
    appVersion: string,
  ): ErrorLogRow {
    const occurredAt = new Date(event.occurredAt);
    const safeOccurredAt = this.isTrustedTimestamp(occurredAt, new Date())
      ? occurredAt
      : new Date();

    return {
      application_id: applicationId,
      request_id: event.requestId ?? "",
      fingerprint: computeErrorFingerprint(
        event.type,
        event.message,
        event.stack,
      ),
      type: event.type,
      message: event.message,
      stack: event.stack ?? "",
      route: event.route ?? "",
      path: event.path ?? "",
      method: event.method ? event.method.toUpperCase() : "",
      status_code: event.statusCode ?? 0,
      env,
      instance_id: instanceId,
      app_version: appVersion,
      ip: event.ip ?? "",
      user_agent: event.userAgent ?? "",
      occurred_at: toClickHouseDate(safeOccurredAt),
    };
  }

  /**
   * Timestamps must be parseable and within [now - 1h, now + 1min]. The wide
   * past bound tolerates retries/back-pressure; the tight future bound blocks
   * bad clocks from creating empty future partitions.
   */
  private isTrustedTimestamp(date: Date, now: Date): boolean {
    if (Number.isNaN(date.getTime())) return false;
    return (
      date.getTime() >= now.getTime() - MAX_PAST_SKEW_MS &&
      date.getTime() <= now.getTime() + MAX_FUTURE_SKEW_MS
    );
  }

  /** Queries paginated request logs. All values are bound as query parameters. */
  async listRequestLogs(
    query: ListBackendMonitorRequestLogsDto,
  ): Promise<{ records: RequestLogRow[]; total: number }> {
    const safeField = ALLOWED_REQUEST_SORT_FIELDS.has(query.sortField ?? "")
      ? query.sortField!
      : "request_at";
    const safeOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
    const keyword = query.keyword ? `%${query.keyword}%` : "%";
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 20;

    const countResult = await this.clickhouse.query({
      query: `
        SELECT count() AS total
        FROM application_request_logs
        WHERE application_id = {applicationId:UUID}
          AND ({hasKeyword:UInt8} = 0 OR path ILIKE {keyword:String})
      `,
      query_params: {
        applicationId: query.applicationId,
        hasKeyword: query.keyword ? 1 : 0,
        keyword,
      },
      format: "JSONEachRow",
    });
    const countRows = (await countResult.json()) as Array<{ total: string }>;
    const total = parseInt(countRows[0]?.total ?? "0", 10);

    const dataResult = await this.clickhouse.query({
      query: `
        SELECT
          application_id, request_id, route, path, method, status_code,
          request_at, response_at, duration_ms, env, instance_id, app_version,
          ip, user_agent, ingested_at
        FROM application_request_logs
        WHERE application_id = {applicationId:UUID}
          AND ({hasKeyword:UInt8} = 0 OR path ILIKE {keyword:String})
        ORDER BY ${safeField} ${safeOrder}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        applicationId: query.applicationId,
        hasKeyword: query.keyword ? 1 : 0,
        keyword,
        limit: pageSize,
        offset: page * pageSize,
      },
      format: "JSONEachRow",
    });
    const records = (await dataResult.json()) as RequestLogRow[];

    return { records, total };
  }

  /** Queries paginated error logs. All values are bound as query parameters. */
  async listErrorLogs(
    query: ListBackendMonitorErrorLogsDto,
  ): Promise<{ records: ErrorLogRow[]; total: number }> {
    const safeField = ALLOWED_ERROR_SORT_FIELDS.has(query.sortField ?? "")
      ? query.sortField!
      : "occurred_at";
    const safeOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
    const keyword = query.keyword ? `%${query.keyword}%` : "%";
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 20;

    const countResult = await this.clickhouse.query({
      query: `
        SELECT count() AS total
        FROM application_error_logs
        WHERE application_id = {applicationId:UUID}
          AND ({hasKeyword:UInt8} = 0
               OR message ILIKE {keyword:String}
               OR path ILIKE {keyword:String})
      `,
      query_params: {
        applicationId: query.applicationId,
        hasKeyword: query.keyword ? 1 : 0,
        keyword,
      },
      format: "JSONEachRow",
    });
    const countRows = (await countResult.json()) as Array<{ total: string }>;
    const total = parseInt(countRows[0]?.total ?? "0", 10);

    const dataResult = await this.clickhouse.query({
      query: `
        SELECT
          application_id, request_id, fingerprint, type, message, stack,
          route, path, method, status_code, env, instance_id, app_version,
          ip, user_agent, occurred_at, ingested_at
        FROM application_error_logs
        WHERE application_id = {applicationId:UUID}
          AND ({hasKeyword:UInt8} = 0
               OR message ILIKE {keyword:String}
               OR path ILIKE {keyword:String})
        ORDER BY ${safeField} ${safeOrder}
        LIMIT {limit:UInt32} OFFSET {offset:UInt32}
      `,
      query_params: {
        applicationId: query.applicationId,
        hasKeyword: query.keyword ? 1 : 0,
        keyword,
        limit: pageSize,
        offset: page * pageSize,
      },
      format: "JSONEachRow",
    });
    const records = (await dataResult.json()) as ErrorLogRow[];

    return { records, total };
  }
}
