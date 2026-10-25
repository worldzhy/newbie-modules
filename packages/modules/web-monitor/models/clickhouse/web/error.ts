import { ClickHouseDataType } from "@modules/clickhouse/clickhouse.types";
import { ClickHouseModel } from "@modules/clickhouse/clickhouse.model";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import { ClickHouseTablePrefix } from "../../enum";

export default function WebError(clickhouse: ClickHouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WEB_ERROR,
    schema: {
      createTime: { type: ClickHouseDataType.DateTime, default: Date.now }, // Created time
      msg: { type: ClickHouseDataType.String }, // Error message
      name: { type: ClickHouseDataType.String }, // JS error type
      stack: { type: ClickHouseDataType.String }, // Stack trace
      target: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Resource type
      type: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Error type
      api: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Source API (onerror, unhandlerejection, Vue/React handlers)
      status: { type: ClickHouseDataType.String }, // HTTP status
      col: { type: ClickHouseDataType.String }, // Column
      line: { type: ClickHouseDataType.String }, // Line
      query: { type: ClickHouseDataType.String }, // HTTP query params
      options: { type: ClickHouseDataType.String }, // POST body params
      method: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Request method
      fullUrl: { type: ClickHouseDataType.String }, // Full error resource URL
      resourceUrl: { type: ClickHouseDataType.String }, // Error resource URL
      url: { type: ClickHouseDataType.String }, // Page URL
      markPage: { type: ClickHouseDataType.String }, // Page mark
      markUser: { type: ClickHouseDataType.String }, // User mark
      phone: { type: ClickHouseDataType.String }, // User phone
      uid: { type: ClickHouseDataType.String }, // User ID
      traceId: { type: ClickHouseDataType.String }, // Trace ID
    },
    options: `ENGINE = MergeTree
    PARTITION BY toYYYYMM(createTime)
    ORDER BY createTime`,
    autoCreate: true,
    autoSync: true,
  };

  const models: Record<string, ClickHouseModel> = {};
  const modelCreates: Record<string, Promise<ClickHouseModel>> = {};
  return async (appId: string) => {
    if (!models[appId]) {
      if (!modelCreates[appId]) {
        modelCreates[appId] = clickhouse.createModel(
          {
            ...schema,
            tableName: schema.tableName + appId,
          },
          dbName,
        );
      }
      const model = await modelCreates[appId];
      delete modelCreates[appId];
      models[appId] = model;
    }
    return models[appId];
  };
}
