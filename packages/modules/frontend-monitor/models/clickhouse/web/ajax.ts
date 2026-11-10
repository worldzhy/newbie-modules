import { ClickHouseDataType } from "@modules/clickhouse/clickhouse.types";
import { ClickHouseModel } from "@modules/clickhouse/clickhouse.model";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import { ClickHouseTablePrefix } from "../../enum";
import { assertAppKey } from "../../../shared/utils";

export default function WebAjax(clickhouse: ClickHouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WEB_AJAX,
    schema: {
      // DateTime is an unsigned 32-bit epoch-seconds column: instants before
      // 1970 or after 2106-02-07 are silently clamped by the writer, not
      // rejected. See the range caveat in shared/utils.ts (R20-32).
      createTime: { type: ClickHouseDataType.DateTime, default: Date.now }, // Created time
      url: { type: ClickHouseDataType.String }, // AJAX URL
      method: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Request method
      duration: { type: ClickHouseDataType.UInt32 }, // AJAX response time (ms)
      bodySize: { type: ClickHouseDataType.Nullable(ClickHouseDataType.Int32) }, // Response size (bytes)
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
  return async (appKey: string) => {
    assertAppKey(appKey);
    if (!models[appKey]) {
      if (!modelCreates[appKey]) {
        modelCreates[appKey] = clickhouse.createModel(
          {
            ...schema,
            tableName: schema.tableName + appKey,
          },
          dbName,
        );
      }
      const model = await modelCreates[appKey];
      delete modelCreates[appKey];
      models[appKey] = model;
    }
    return models[appKey];
  };
}
