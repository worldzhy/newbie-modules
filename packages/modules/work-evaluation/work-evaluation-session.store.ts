import { Injectable } from "@nestjs/common";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";

/** ClickHouse table holding session transcript chunks (ADR-024). */
export const SESSION_MESSAGE_TABLE = "work_evaluation_session_messages";

export interface SessionMessageRow {
  evaluatee_user_id: string;
  session_id: string;
  workspace_key: string;
  seq: number;
  role: string;
  content: string;
  tool_name: string;
  tool_calls: string;
  token_count: number;
  created_at: string;
}

/**
 * Transcript storage for collected agent sessions.
 *
 * The transcript is the raw material the evaluation agent drills into; PG only
 * keeps the session index (WorkEvaluationSession). Rows are chunked by the
 * installation agent before upload and compressed by the ClickHouse column codec.
 *
 * The table engine is ReplacingMergeTree(ingested_at) keyed by
 * (evaluatee_user_id, session_id, seq): re-ingesting the same batch inserts
 * duplicate rows that collapse into the newest version. Reads must use FINAL
 * so duplicates are invisible even before the background merge runs.
 */
@Injectable()
export class WorkEvaluationSessionStore {
  constructor(private readonly clickhouse: ClickHouseService) {}

  async insertMessages(rows: SessionMessageRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.clickhouse.insert({
      table: SESSION_MESSAGE_TABLE,
      values: rows,
      format: "JSONEachRow",
    });
  }

  /** Messages of one session in sequence order, optionally from a given seq. */
  async fetchMessages(
    sessionId: string,
    options: { fromSeq?: number; limit?: number } = {},
  ): Promise<SessionMessageRow[]> {
    const result = await this.clickhouse.query({
      query: [
        `SELECT evaluatee_user_id, session_id, workspace_key, seq, role, content, tool_name, tool_calls, token_count, created_at`,
        `FROM ${SESSION_MESSAGE_TABLE} FINAL`,
        `WHERE session_id = {sessionId:UUID} AND seq >= {fromSeq:UInt32}`,
        `ORDER BY seq ASC`,
        `LIMIT {limit:UInt32}`,
      ].join(" "),
      format: "JSONEachRow",
      query_params: {
        sessionId,
        fromSeq: options.fromSeq ?? 0,
        limit: options.limit ?? 200,
      },
    });
    return (await result.json()) as SessionMessageRow[];
  }

  /** Message counts for many sessions in one query — coverage accounting. */
  async countMessagesBySession(sessionIds: string[]): Promise<Map<string, number>> {
    if (sessionIds.length === 0) return new Map();
    const result = await this.clickhouse.query({
      query: `SELECT session_id, count() AS total FROM ${SESSION_MESSAGE_TABLE} FINAL WHERE session_id IN {sessionIds:Array(UUID)} GROUP BY session_id`,
      format: "JSONEachRow",
      query_params: { sessionIds },
    });
    const rows = (await result.json()) as { session_id: string; total: string | number }[];
    return new Map(rows.map((row) => [row.session_id, Number(row.total)]));
  }
}
