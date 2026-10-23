import { ClickHouseDataType } from "@modules/clickhouse/clickhouse.types";
import { ClickHouseModel } from "@modules/clickhouse/clickhouse.model";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import { ClickHouseTablePrefix } from "../../enum";

export default function WebAjax(clickhouse: ClickHouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WEB_AJAX,
    schema: {
      createTime: { type: ClickHouseDataType.DateTime, default: Date.now }, // Created time
      url: { type: ClickHouseDataType.String }, // AJAX URL
      method: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Request method
      duration: { type: ClickHouseDataType.UInt32 }, // AJAX response time (ms)
      bodySize: { type: ClickHouseDataType.Int32 }, // Response size (bytes)
      options: { type: ClickHouseDataType.String }, // Request body options
      query: { type: ClickHouseDataType.String }, // Query params
      fullUrl: { type: ClickHouseDataType.String }, // Full URL
      callUrl: { type: ClickHouseDataType.String }, // Calling page URL
      markPage: { type: ClickHouseDataType.String }, // Page mark
      markUser: { type: ClickHouseDataType.String }, // User mark
      phone: { type: ClickHouseDataType.String }, // User phone
      uid: { type: ClickHouseDataType.String }, // User ID
      traceId: { type: ClickHouseDataType.String }, // Server trace ID
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
