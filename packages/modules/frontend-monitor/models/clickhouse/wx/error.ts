import {ClickhouseDataType} from '@modules/clickhouse/clickhouse.types';
import {ClickhouseService} from '@modules/clickhouse/clickhouse.service';
import {ClickHouseTablePrefix} from '../../enum';

export default function WxError(clickhouse: ClickhouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WX_ERROR,
    schema: {
      createTime: {type: ClickhouseDataType.DateTime, default: Date.now}, // Created time
      msg: {type: ClickhouseDataType.String}, // Error message
      stack: {type: ClickhouseDataType.String}, // Error stack
      errorType: {type: ClickhouseDataType.String}, // JS error type
      type: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // Error type
      status: {type: ClickhouseDataType.String}, // HTTP status
      col: {type: ClickhouseDataType.String}, // Column
      line: {type: ClickhouseDataType.String}, // Line
      query: {type: ClickhouseDataType.String}, // HTTP query params
      options: {type: ClickhouseDataType.String}, // POST body params
      method: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // Request method
      fullName: {type: ClickhouseDataType.String}, // Full error resource URL
      name: {type: ClickhouseDataType.String}, // Error resource URL
      path: {type: ClickhouseDataType.String}, // Page path
      markPage: {type: ClickhouseDataType.String}, // Page mark
      markUser: {type: ClickhouseDataType.String}, // User mark
      phone: {type: ClickhouseDataType.String}, // User phone
      uid: {type: ClickhouseDataType.String}, // User ID
      traceId: {type: ClickhouseDataType.String}, // Trace ID
    },
    options: `ENGINE = MergeTree
    PARTITION BY toYYYYMM(createTime)
    ORDER BY createTime`,
    autoCreate: true,
    autoSync: true,
  };

  const models: Record<string, any> = {};
  const modelCreates: Record<string, Promise<any>> = {};
  return async (appId: string) => {
    if (!models[appId]) {
      if (!modelCreates[appId]) {
        modelCreates[appId] = clickhouse.createModel(
          {
            ...schema,
            tableName: schema.tableName + appId,
          },
          dbName
        );
      }
      const model = await modelCreates[appId];
      delete modelCreates[appId];
      models[appId] = model;
    }
    return models[appId];
  };
}
