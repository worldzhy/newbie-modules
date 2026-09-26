import {Injectable, OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClickhouseService} from '@modules/clickhouse/clickhouse.service';

import WebAjaxFactory from './web/ajax';
import WebErrorFactory from './web/error';
import WebSdkErrorFactory from './web/sdk-error';

@Injectable()
export class MonitorClickhouseService implements OnModuleInit {
  private webAjaxFactory: (appId: string) => Promise<any>;
  private webErrorFactory: (appId: string) => Promise<any>;
  private webSdkErrorFactory: () => Promise<any>;

  constructor(
    private readonly configService: ConfigService,
    private readonly clickhouse: ClickhouseService
  ) {}

  async onModuleInit() {
    // The shared ClickhouseService owns the @clickhouse/client connection and
    // exposes the ORM-like helpers (createDatabase / model). The business layer
    // only needs to select which database to use.
    const dbName =
      this.configService.get<string>('modules.web-monitor.clickhouseDB') ||
      this.configService.getOrThrow<string>('modules.clickhouse.database');

    // Ensure the database exists before creating tables.
    await this.clickhouse.createDatabase(dbName);

    // Initialize table factories with the shared service and database name.
    this.webAjaxFactory = WebAjaxFactory(this.clickhouse, dbName);
    this.webErrorFactory = WebErrorFactory(this.clickhouse, dbName);
    this.webSdkErrorFactory = WebSdkErrorFactory(this.clickhouse, dbName);
  }

  async WebAjax(appId: string) {
    return this.webAjaxFactory(appId);
  }

  async WebError(appId: string) {
    return this.webErrorFactory(appId);
  }

  async WebSdkError() {
    return this.webSdkErrorFactory();
  }
}
