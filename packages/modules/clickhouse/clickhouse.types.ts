// ClickHouse column data types used by table schemas.
export const ClickHouseDataType = {
  String: "String",
  // UTC is declared explicitly instead of relying on the server's timezone
  // setting (usually "UTC" by convention, never enforced). Without it a server
  // configured for another zone silently reinterprets every inserted instant,
  // and alert queries that convert Shanghai wall-clock bounds would be off by
  // the offset (R20-33).
  DateTime: "DateTime('UTC')",
  UInt16: "UInt16",
  UInt32: "UInt32",
  Int32: "Int32",
  LowCardinality: (inner: string) => `LowCardinality(${inner})`,
  // Nullable(inner) keeps "value absent" distinguishable from the column's
  // zero/default value (R12-02).
  Nullable: (inner: string) => `Nullable(${inner})`,
} as const;

// Column definition: type + optional default value
export interface ClickHouseColumnDef {
  type: string;
  default?: unknown;
}

// Schema config: table name, columns, engine options
export interface ClickHouseTableConfig {
  tableName: string;
  schema: Record<string, ClickHouseColumnDef>;
  // e.g. "ENGINE = MergeTree PARTITION BY toYYYYMM(createTime) ORDER BY createTime"
  options: string;
  // When true (default), CREATE TABLE IF NOT EXISTS is issued on first createModel() call.
  autoCreate?: boolean;
  // When true, an existing table is compared against the code schema and
  // ALTER TABLE ADD/DROP/MODIFY COLUMN is issued to reconcile differences.
  // autoCreate must also be truthy for sync to run.
  autoSync?: boolean;
}

// Column metadata as returned by DESCRIBE TABLE — {name, type} pairs.
export interface ClickHouseColumnMeta {
  name: string;
  type: string;
}

// Schema diff produced by comparing code schema against table metadata.
export interface ClickHouseSchemaDiff {
  addColumns: Array<{ name: string; type: string }>;
  deleteColumns: string[];
  modifyColumns: Array<{ name: string; type: string }>;
}

// Query builder object for SELECT statements.
export interface ClickHouseQueryObject {
  select?: string;
  // WHERE clause as raw SQL. User-supplied values MUST use {name:Type}
  // placeholders and be supplied via queryParams — never interpolate directly.
  where?: string;
  limit?: number;
  skip?: number;
  orderBy?: string;
  groupBy?: string;
  // Bound parameters for {name:Type} placeholders in where/select/etc.
  queryParams?: Record<string, unknown>;
}

// Delete object — ALTER TABLE ... DELETE WHERE ...
export interface ClickHouseDeleteObject {
  // WHERE clause. Same parameterization rule as ClickHouseQueryObject.where.
  where: string;
  queryParams?: Record<string, unknown>;
}
