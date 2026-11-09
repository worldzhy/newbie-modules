import { Injectable } from "@nestjs/common";
import { DeleteResult } from "mongodb";
import { WebMonitorModelsService } from "../../models/mongo/web-monitor-models.service";
import { NodeCacheService } from "../../shared/node-cache.service";
import { func } from "../../shared/utils";

@Injectable()
export class SiteService {
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly nodeCache: NodeCacheService,
  ) {}

  async updateSiteData(appKey: string, body: Record<string, unknown>) {
    const update = {
      $set: {
        systemName: body.systemName || "",
        systemDomain: body.systemDomain || "",
        slowPageTime: body.slowPageTime || 5,
        slowWhiteTime: body.slowWhiteTime || 2,
        slowJsTime: body.slowJsTime || 2,
        type: body.type || "web",
        slowCssTime: body.slowCssTime || 2,
        slowImgTime: body.slowImgTime || 2,
        slowAjaxTime: body.slowAjaxTime || 2,
      },
    };
    const result = await this.models.System().updateOne({ appKey: appKey }, update, { multi: true }).exec();
    await this.updateSiteNodeCache(appKey);
    return func.result({ data: result });
  }

  async updateSiteNodeCache(appKey: string) {
    const system = await this.getSiteForDb(appKey);
    if (system) this.nodeCache.updateSiteCache(system);
  }

  /**
   * Upserts the Mongo System document backing a web-monitor installation.
   * The document carries the anomaly detection thresholds (config truth source
   * stays in Mongo); appKey equals the installation's immutable appKey.
   * Idempotent by appKey so it can be safely retried after credential issuance.
   */
  async upsertSiteForWebMonitor(body: { appKey: string; systemName: string }) {
    const result = await this.models
      .System()
      .findOneAndUpdate(
        { appKey: body.appKey },
        { $set: { systemName: body.systemName, type: "web" } },
        { upsert: true, new: true },
      )
      .exec();
    await this.updateSiteNodeCache(body.appKey);
    return result;
  }

  async getSiteForDb(appKey: string) {
    if (!appKey) throw new Error("Query a system: appKey must not be empty");
    return await this.models.System().findOne({ appKey: appKey }).exec();
  }

  /**
   * List systems inside an already-resolved appKey scope. Visibility is the
   * caller's concern: this service never sees a user or resolves a project.
   */
  async getSitesInAppKeys(query: Record<string, unknown>, appKeys: string[]) {
    const { systemName, type, appKey } = query;
    const param: Record<string, unknown> = {};
    if (systemName) param.systemName = new RegExp(func.escapeRegExp(systemName));
    if (type) param.type = type;
    // The controller has already proven an explicit appKey is in scope, so it is
    // used as-is; otherwise the query is limited to the whole resolved scope.
    param.appKey = appKey ? String(appKey) : { $in: appKeys };
    return (await this.models.System().find(param).exec()) || [];
  }

  async getSiteForAppId(appKey: string) {
    if (!appKey) throw new Error("Query a system: appKey must not be empty");
    const cached = this.nodeCache.getAppInfo(appKey);
    if (cached) return cached;
    // Cache miss (cold start, or a site created outside the API): fall back to
    // Mongo and backfill so ingest never rejects a legitimate appKey with a 500.
    const system = await this.getSiteForDb(appKey);
    if (system) this.nodeCache.updateSiteCache(system);
    return system;
  }

  async getSiteList() {
    return (await this.models.System().find({}).exec()) || [];
  }

  async getWebSiteList() {
    return (await this.models.System().find({ type: "web" }).exec()) || [];
  }

  /** List web sites inside an already-resolved appKey scope. */
  async getWebSiteListInAppKeys(appKeys: string[]) {
    return (
      (await this.models
        .System()
        .find({ type: "web", appKey: { $in: appKeys } })
        .exec()) || []
    );
  }

  async deleteWebSiteUser(appKey: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appKey: appKey }, { $pull: { userId: userToken } }, { multi: true })
      .exec();
  }
  async addWebSiteUser(appKey: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appKey: appKey }, { $push: { userId: userToken } }, { multi: true })
      .exec();
  }

  async deleteSite(appKey: string, type: string): Promise<DeleteResult> {
    const result = await this.models.System().deleteOne({ appKey: appKey, type }).exec();
    this.nodeCache.removeAppInfo(appKey);
    return result;
  }
}
