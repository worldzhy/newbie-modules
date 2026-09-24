import {ClickhouseDataType} from '@microservices/clickhouse/clickhouse.types';
import {ClickhouseService} from '@microservices/clickhouse/clickhouse.service';
import {ClickHouseTablePrefix} from '../../enum';

export default function WxEvent(clickhouse: ClickhouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WX_EVENT,
    schema: {
      appId: {type: ClickhouseDataType.String}, // App ID
      event: {type: ClickhouseDataType.String}, // Event type
      createTime: {type: ClickhouseDataType.DateTime, default: Date.now}, // Created time
      path: {type: ClickhouseDataType.String}, // Page path
      duration: {type: ClickhouseDataType.UInt32}, // Duration (ms)
      ip: {type: ClickhouseDataType.String}, // IP
      markUser: {type: ClickhouseDataType.String}, // User mark
      markUv: {type: ClickhouseDataType.String}, // UV mark
      markPage: {type: ClickhouseDataType.String}, // Page mark
      phone: {type: ClickhouseDataType.String}, // User phone
      uid: {type: ClickhouseDataType.String}, // User ID
      net: {type: ClickhouseDataType.String}, // Network type
      model: {type: ClickhouseDataType.String}, // Device model
      brand: {type: ClickhouseDataType.String}, // Device brand
      system: {type: ClickhouseDataType.String}, // System
      language: {type: ClickhouseDataType.String}, // WeChat language
      version: {type: ClickhouseDataType.String}, // WeChat version
      sdkVersion: {type: ClickhouseDataType.String}, // Base library version
      platform: {type: ClickhouseDataType.String}, // Platform
      screenWidth: {type: ClickhouseDataType.UInt16}, // Screen width
      screenHeight: {type: ClickhouseDataType.UInt16}, // Screen height
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
