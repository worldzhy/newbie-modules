import type { ClickhouseService } from "./clickhouse.service";
import type { ClickhouseDeleteObject, ClickhouseQueryObject, ClickhouseTableConfig } from "./clickhouse.types";

/**
 * Model bound to a single ClickHouse table. Provides a query builder for find()
 * and an ALTER TABLE DELETE helper for delete().
 */
export class ClickhouseModel<T = Record<string, unknown>> {
  constructor(
    private readonly ch: ClickhouseService,
    private readonly table: string,
    private readonly config: ClickhouseTableConfig,
  ) {}

  // Query builder: single object or chained array (subquery wrapping).
  async find(qObjArray: ClickhouseQueryObject | ClickhouseQueryObject[]): Promise<T[]> {
    if (!Array.isArray(qObjArray)) qObjArray = [qObjArray];
    let sql = "";
    const queryParams: Record<string, unknown> = {};
    qObjArray.forEach((qObj, i) => {
      const target = i === 0 ? this.table : `(${sql})`;
      sql = this.objectToSql(target, qObj);
      // Merge bound parameters from every subquery (later keys win on clash).
      if (qObj.queryParams) Object.assign(queryParams, qObj.queryParams);
    });
    const result = await this.ch.query({
      query: sql,
      format: "JSONEachRow",
      ...(Object.keys(queryParams).length ? { query_params: queryParams } : {}),
    });
    return (await result.json()) as T[];
  }

  // ALTER TABLE ... DELETE WHERE ...
  async delete(delObj: ClickhouseDeleteObject): Promise<void> {
    const sql = `ALTER TABLE ${this.table} DELETE WHERE ${delObj.where}`;
    await this.ch.query({
      query: sql,
      ...(delObj.queryParams ? { query_params: delObj.queryParams } : {}),
    });
  }

  // INSERT INTO ... VALUES (for SDK ingestion endpoints if needed).
  async insertMany(rows: T[]): Promise<void> {
    if (!rows.length) return;
    const columns = Object.keys(this.config.schema);
    await this.ch.insert({
      table: this.table,
      values: rows.map((r) =>
        columns.reduce((obj, col) => ({ ...obj, [col]: (r as Record<string, unknown>)[col] ?? null }), {}),
      ),
      format: "JSONEachRow",
    });
  }

  // Build SELECT SQL from a query object.
  private objectToSql(table: string, q: ClickhouseQueryObject): string {
    const where = q.where ? ` WHERE ${q.where}` : "";
    const groupBy = q.groupBy ? ` GROUP BY ${q.groupBy}` : "";
    const orderBy = q.orderBy ? ` ORDER BY ${q.orderBy}` : "";
    // Coerce limit/skip to finite numbers so callers passing string-typed
    // query params cannot inject into the LIMIT clause.
    const limitNum = Number.isFinite(q.limit) ? Math.trunc(q.limit as number) : undefined;
    const skipNum = Number.isFinite(q.skip) ? Math.trunc(q.skip as number) : undefined;
    const limit = limitNum ? ` LIMIT ${skipNum ? `${skipNum},` : ""}${limitNum}` : "";
    return `SELECT ${q.select || "*"} FROM ${table}${where}${groupBy}${orderBy}${limit}`;
  }
}
