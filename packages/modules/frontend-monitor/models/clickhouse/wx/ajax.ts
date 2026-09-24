import {ClickhouseDataType} from '@microservices/clickhouse/clickhouse.types';
import {ClickhouseService} from '@microservices/clickhouse/clickhouse.service';
import {ClickHouseTablePrefix} from '../../enum';

export default function WxAjax(clickhouse: ClickhouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WX_AJAX,
    schema: {
      createTime: {type: ClickhouseDataType.DateTime, default: Date.now}, // Created time
      url: {type: ClickhouseDataType.String}, // AJAX URL
      method: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // Request method
      duration: {type: ClickhouseDataType.UInt32, default: 0}, // AJAX response time (ms)
      bodySize: {type: ClickhouseDataType.Int32, default: 0}, // Response size (bytes)
      options: {type: ClickhouseDataType.String}, // Request body options
      query: {type: ClickhouseDataType.String}, // Query params
      fullUrl: {type: ClickhouseDataType.String}, // Full URL
      callUrl: {type: ClickhouseDataType.String}, // Calling page URL
      markPage: {type: ClickhouseDataType.String}, // Page mark
      markUser: {type: ClickhouseDataType.String}, // User mark
      phone: {type: ClickhouseDataType.String}, // User phone
      uid: {type: ClickhouseDataType.String}, // User ID
      traceId: {type: ClickhouseDataType.String}, // Server trace ID
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
