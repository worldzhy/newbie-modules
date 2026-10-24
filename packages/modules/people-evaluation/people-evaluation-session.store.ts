import { Injectable } from "@nestjs/common";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";

/** ClickHouse table holding session transcript chunks (ADR-029). */
export const SESSION_MESSAGE_TABLE = "people_evaluation_session_messages";

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
 * The transcript is the raw material the assessment agent drills into; PG only
 * keeps the session index (PeopleEvaluationAgentSession). Rows are chunked by
 * the worklog agent before upload and compressed by the ClickHouse column codec.
 */
@Injectable()
export class PeopleEvaluationSessionStore {
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
        `FROM ${SESSION_MESSAGE_TABLE}`,
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

  /** Number of stored message rows per session — used in coverage accounting. */
  async countMessages(sessionId: string): Promise<number> {
    const result = await this.clickhouse.query({
      query: `SELECT count() AS total FROM ${SESSION_MESSAGE_TABLE} WHERE session_id = {sessionId:UUID}`,
      format: "JSONEachRow",
      query_params: { sessionId },
    });
    const rows = (await result.json()) as { total: string | number }[];
    return Number(rows[0]?.total ?? 0);
  }
}
