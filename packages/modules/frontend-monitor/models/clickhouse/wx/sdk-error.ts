import {ClickhouseDataType} from '@modules/clickhouse/clickhouse.types';
import {ClickhouseService} from '@modules/clickhouse/clickhouse.service';
import {ClickHouseTablePrefix} from '../../enum';

export default function WxSdkError(clickhouse: ClickhouseService, dbName: string) {
  const schema = {
    tableName: ClickHouseTablePrefix.WX_SDK_ERROR,
    schema: {
      createTime: {type: ClickhouseDataType.DateTime, default: Date.now}, // Created time
      appId: {type: ClickhouseDataType.String}, // App ID
      name: {type: ClickhouseDataType.String}, // Error name
      msg: {type: ClickhouseDataType.String}, // Error message
      stack: {type: ClickhouseDataType.String}, // Error stack
      sdkV: {type: ClickhouseDataType.String}, // Monitoring SDK version
      markUser: {type: ClickhouseDataType.String}, // User mark
      phone: {type: ClickhouseDataType.String}, // User phone
      uid: {type: ClickhouseDataType.String}, // User ID
      brand: {type: ClickhouseDataType.String}, // Device brand
      model: {type: ClickhouseDataType.String}, // Device model
      screenWidth: {type: ClickhouseDataType.UInt16}, // Screen width
      screenHeight: {type: ClickhouseDataType.UInt16}, // Screen height
      language: {type: ClickhouseDataType.String}, // WeChat language
      version: {type: ClickhouseDataType.String}, // WeChat version
      system: {type: ClickhouseDataType.LowCardinality(ClickhouseDataType.String)}, // OS version
      platform: {type: ClickhouseDataType.String}, // Platform
      sdkVersion: {type: ClickhouseDataType.String}, // Base library version
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
