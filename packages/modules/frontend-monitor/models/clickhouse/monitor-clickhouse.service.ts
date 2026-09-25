import {Injectable, OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClickhouseService} from '@modules/clickhouse/clickhouse.service';

import WebAjaxFactory from './web/ajax';
import WebErrorFactory from './web/error';
import WebSdkErrorFactory from './web/sdk-error';
import WxAjaxFactory from './wx/ajax';
import WxErrorFactory from './wx/error';
import WxEventFactory from './wx/event';
import WxSdkErrorFactory from './wx/sdk-error';

@Injectable()
export class MonitorClickhouseService implements OnModuleInit {
  private webAjaxFactory: (appId: string) => Promise<any>;
  private webErrorFactory: (appId: string) => Promise<any>;
  private wxAjaxFactory: (appId: string) => Promise<any>;
  private wxErrorFactory: (appId: string) => Promise<any>;
  private wxEventFactory: (appId: string) => Promise<any>;
  private webSdkErrorFactory: () => Promise<any>;
  private wxSdkErrorFactory: () => Promise<any>;

  constructor(
    private readonly configService: ConfigService,
    private readonly clickhouse: ClickhouseService
  ) {}

  async onModuleInit() {
    // The shared ClickhouseService owns the @clickhouse/client connection and
    // exposes the ORM-like helpers (createDatabase / model). The business layer
    // only needs to select which database to use.
    const dbName =
      this.configService.get<string>('modules.frontend-monitor.clickhouseDB') ||
      this.configService.getOrThrow<string>('modules.clickhouse.database');

    // Ensure the database exists before creating tables.
    await this.clickhouse.createDatabase(dbName);

    // Initialize table factories with the shared service and database name.
    this.webAjaxFactory = WebAjaxFactory(this.clickhouse, dbName);
    this.webErrorFactory = WebErrorFactory(this.clickhouse, dbName);
    this.webSdkErrorFactory = WebSdkErrorFactory(this.clickhouse, dbName);

    this.wxAjaxFactory = WxAjaxFactory(this.clickhouse, dbName);
    this.wxErrorFactory = WxErrorFactory(this.clickhouse, dbName);
    this.wxEventFactory = WxEventFactory(this.clickhouse, dbName);
    this.wxSdkErrorFactory = WxSdkErrorFactory(this.clickhouse, dbName);
  }

  async WebAjax(appId: string) {
    return this.webAjaxFactory(appId);
  }

  async WebError(appId: string) {
    return this.webErrorFactory(appId);
  }

  async WxAjax(appId: string) {
    return this.wxAjaxFactory(appId);
  }

  async WxError(appId: string) {
    return this.wxErrorFactory(appId);
  }

  async WxEvent(appId: string) {
    return this.wxEventFactory(appId);
  }

  async WebSdkError() {
    return this.webSdkErrorFactory();
  }

  async WxSdkError() {
    return this.wxSdkErrorFactory();
  }
}
