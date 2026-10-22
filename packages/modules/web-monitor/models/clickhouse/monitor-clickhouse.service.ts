import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClickhouseModel, ClickhouseService } from "@modules/clickhouse/clickhouse.service";

import WebAjaxFactory from "./web/ajax";
import WebErrorFactory from "./web/error";
import WebSdkErrorFactory from "./web/sdk-error";

@Injectable()
export class MonitorClickhouseService implements OnModuleInit {
  private webAjaxFactory!: (appId: string) => Promise<ClickhouseModel>;
  private webErrorFactory!: (appId: string) => Promise<ClickhouseModel>;
  private webSdkErrorFactory!: () => Promise<ClickhouseModel>;

  constructor(
    private readonly configService: ConfigService,
    private readonly clickhouse: ClickhouseService,
  ) {}

  async onModuleInit() {
    // The shared ClickhouseService owns the @clickhouse/client connection and
    // exposes the ORM-like helpers (createDatabase / model). The database is
    // always the host-level shared one (ADR-015); collector modules do not
    // carry their own deployment topology.
    const dbName = this.configService.getOrThrow<string>("modules.clickhouse.database");

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
