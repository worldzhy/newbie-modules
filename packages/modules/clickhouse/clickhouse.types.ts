// ClickHouse column data types used by table schemas.
export const ClickhouseDataType = {
  String: "String",
  DateTime: "DateTime",
  UInt16: "UInt16",
  UInt32: "UInt32",
  Int32: "Int32",
  LowCardinality: (inner: string) => `LowCardinality(${inner})`,
} as const;

// Column definition: type + optional default value
export interface ClickhouseColumnDef {
  type: string;
  default?: unknown;
}

// Schema config: table name, columns, engine options
export interface ClickhouseTableConfig {
  tableName: string;
  schema: Record<string, ClickhouseColumnDef>;
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
export interface ClickhouseColumnMeta {
  name: string;
  type: string;
}

// Schema diff produced by comparing code schema against table metadata.
export interface ClickhouseSchemaDiff {
  addColumns: Array<{ name: string; type: string }>;
  deleteColumns: string[];
  modifyColumns: Array<{ name: string; type: string }>;
}

// Query builder object for SELECT statements.
export interface ClickhouseQueryObject {
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
export interface ClickhouseDeleteObject {
  // WHERE clause. Same parameterization rule as ClickhouseQueryObject.where.
  where: string;
  queryParams?: Record<string, unknown>;
}
