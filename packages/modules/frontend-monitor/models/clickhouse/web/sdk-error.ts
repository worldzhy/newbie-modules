import {ClickhouseDataType} from '@microservices/clickhouse/clickhouse.types';
import {ClickhouseService} from '@microservices/clickhouse/clickhouse.service';
import {ClickHouseTablePrefix} from '../../enum';

export default function WebSdkError(clickhouse: ClickhouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WEB_SDK_ERROR,
    schema: {
      createTime: {type: ClickhouseDataType.DateTime, default: Date.now}, // Created time
      appId: {type: ClickhouseDataType.String}, // App ID
      name: {type: ClickhouseDataType.String}, // Error name
      msg: {type: ClickhouseDataType.String}, // Error message
      stack: {type: ClickhouseDataType.String}, // Error stack
      sdkVersion: {type: ClickhouseDataType.String}, // SDK version
      markUser: {type: ClickhouseDataType.String}, // User mark
      phone: {type: ClickhouseDataType.String}, // User phone
      uid: {type: ClickhouseDataType.String}, // User ID
      browser: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // Browser
      browserVersion: {type: ClickhouseDataType.String}, // Browser version
      system: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // System
      systemVersion: {type: ClickhouseDataType.String}, // System version
    },
    options: `ENGINE = MergeTree
    PARTITION BY toYYYYMM(createTime)
    ORDER BY createTime`,
    autoCreate: true,
    autoSync: true,
  };

  let _model: any = null;
  return async () => {
    if (!_model) {
      _model = await clickhouse.createModel(schema, dbName);
    }
    return _model;
  };
}
