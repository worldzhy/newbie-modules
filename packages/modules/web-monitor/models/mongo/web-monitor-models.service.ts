import { Injectable } from "@nestjs/common";
import { MongoModelRegistry } from "@modules/mongo/mongo-model.registry";

import { SystemSchema, SystemDocument } from "./system.schema";
import { DayReportNumSchema, DayReportNumDocument } from "./day-report-num.schema";

import { WebEnvironmentSchema, WebEnvironmentDocument } from "./web/web-environment.schema";
import { WebPageSchema, WebPageDocument } from "./web/web-page.schema";
import { WebResourceSchema, WebResourceDocument } from "./web/web-resource.schema";
import {
  WebCustomSchema,
  WebCustomDocument,
  WebCustomFilterSchema,
  WebCustomFilterDocument,
} from "./web/web-custom.schema";
import { WebPvuvipSchema, WebPvuvipDocument } from "./web/web-pvuvip.schema";

import { MongoCollectionPrefix, MongoStaticCollection } from "../enum";
import { assertAppKey } from "../../shared/utils";

@Injectable()
export class WebMonitorModelsService {
  constructor(private readonly modelRegistry: MongoModelRegistry) {}

  // Model registration mechanics (register-once / OverwriteModelError guard)
  // live in the shared MongoModelRegistry; this service only maps business
  // schemas to collection names (incl. per-appKey dynamic collections).

  // Static models
  System() {
    return this.modelRegistry.getOrCreateModel<SystemDocument>(MongoStaticCollection.System, SystemSchema);
  }

  DayReportNum() {
    return this.modelRegistry.getOrCreateModel<DayReportNumDocument>(
      MongoStaticCollection.DayReportNum,
      DayReportNumSchema,
    );
  }

  // WEB dynamic models (by appKey)
  WebEnvironment(appKey: string) {
    assertAppKey(appKey);
    return this.modelRegistry.getOrCreateModel<WebEnvironmentDocument>(
      `${MongoCollectionPrefix.WEB_ENVIRONMENT}${appKey}`,
      WebEnvironmentSchema,
    );
  }

  WebPage(appKey: string) {
    assertAppKey(appKey);
    return this.modelRegistry.getOrCreateModel<WebPageDocument>(
      `${MongoCollectionPrefix.WEB_PAGE}${appKey}`,
      WebPageSchema,
    );
  }

  WebResource(appKey: string) {
    assertAppKey(appKey);
    return this.modelRegistry.getOrCreateModel<WebResourceDocument>(
      `${MongoCollectionPrefix.WEB_RESOURCE}${appKey}`,
      WebResourceSchema,
    );
  }

  WebCustom(appKey: string) {
    assertAppKey(appKey);
    return this.modelRegistry.getOrCreateModel<WebCustomDocument>(
      `${MongoCollectionPrefix.WEB_CUSTOM}${appKey}`,
      WebCustomSchema,
    );
  }

  WebCustomFilter(appKey: string) {
    assertAppKey(appKey);
    return this.modelRegistry.getOrCreateModel<WebCustomFilterDocument>(
      `${MongoCollectionPrefix.WEB_CUSTOM_FILTER}${appKey}`,
      WebCustomFilterSchema,
    );
  }

  // WEB pvuvip is static in v4
  WebPvuvip() {
    return this.modelRegistry.getOrCreateModel<WebPvuvipDocument>(MongoStaticCollection.WebPvUvIp, WebPvuvipSchema);
  }
}
