import { ClickHouseDataType } from "@modules/clickhouse/clickhouse.types";
import { ClickHouseModel } from "@modules/clickhouse/clickhouse.model";
import { ClickHouseService } from "@modules/clickhouse/clickhouse.service";
import { ClickHouseTablePrefix } from "../../enum";

export default function WebSdkError(clickhouse: ClickHouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WEB_SDK_ERROR,
    schema: {
      createTime: { type: ClickHouseDataType.DateTime, default: Date.now }, // Created time
      appId: { type: ClickHouseDataType.String }, // App ID
      name: { type: ClickHouseDataType.String }, // Error name
      msg: { type: ClickHouseDataType.String }, // Error message
      stack: { type: ClickHouseDataType.String }, // Error stack
      sdkVersion: { type: ClickHouseDataType.String }, // SDK version
      markUser: { type: ClickHouseDataType.String }, // User mark
      phone: { type: ClickHouseDataType.String }, // User phone
      uid: { type: ClickHouseDataType.String }, // User ID
      browser: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // Browser
      browserVersion: { type: ClickHouseDataType.String }, // Browser version
      system: { type: ClickHouseDataType.LowCardinality(ClickHouseDataType.String) }, // System
      systemVersion: { type: ClickHouseDataType.String }, // System version
    },
    options: `ENGINE = MergeTree
    PARTITION BY toYYYYMM(createTime)
    ORDER BY createTime`,
    autoCreate: true,
    autoSync: true,
  };

  let _model: ClickHouseModel | null = null;
  return async () => {
    if (!_model) {
      _model = await clickhouse.createModel(schema, dbName);
    }
    return _model;
  };
}
