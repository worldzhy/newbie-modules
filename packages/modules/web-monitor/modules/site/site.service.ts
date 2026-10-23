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

  async saveSiteData(body: Record<string, unknown>) {
    const type = typeof body.type === "string" ? body.type : undefined;
    if (!body.projectId) return func.errResult({ desc: "A new system must belong to a project" });
    if (!body.systemDomain && type === "web")
      return func.errResult({ desc: "Add system: system domain must not be empty" });
    if (!body.systemName) return func.errResult({ desc: "Add system: system name must not be empty" });

    if (type === "web") {
      const search = await this.models
        .System()
        .findOne({ systemDomain: String(body.systemDomain) })
        .exec();
      if (search && search.systemDomain) return func.errResult({ desc: "Add system: system already exists" });
    }

    const appId = body.appId ? String(body.appId) : func.randomString();
    const SystemModel = this.models.System();
    const system = new SystemModel();
    system.projectId = String(body.projectId);
    system.systemDomain = typeof body.systemDomain === "string" ? body.systemDomain : "";
    system.systemName = String(body.systemName);
    system.type = type || "web";
    system.appId = appId;
    system.userId = [typeof body.token === "string" ? body.token : ""];
    system.createTime = new Date();
    system.slowPageTime = Number(body.slowPageTime) || 5;
    system.slowWhiteTime = Number(body.slowWhiteTime) || 2;
    system.slowJsTime = Number(body.slowJsTime) || 2;
    system.slowCssTime = Number(body.slowCssTime) || 2;
    system.slowImgTime = Number(body.slowImgTime) || 2;
    system.slowAjaxTime = Number(body.slowAjaxTime) || 2;

    const result = await system.save();
    await this.updateSiteNodeCache(appId);
    return func.result({ data: result });
  }

  async updateSiteData(body: Record<string, unknown>) {
    const appId = body.appId;
    if (!appId) return func.errResult({ desc: "Update system: appId must not be empty" });
    const appIdStr = String(appId);

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
    const result = await this.models.System().updateOne({ appId: appIdStr }, update, { multi: true }).exec();
    await this.updateSiteNodeCache(appIdStr);
    return func.result({ data: result });
  }

  async updateSiteNodeCache(appId: string) {
    const system = await this.getSiteForDb(appId);
    if (system) this.nodeCache.updateSiteCache(system);
  }

  /**
   * Upserts the Mongo System document backing a web-monitor installation.
   * The document carries the anomaly detection thresholds (config truth source
   * stays in Mongo); appId equals the installation's immutable appKey.
   * Idempotent by appId so it can be safely retried after credential issuance.
   */
  async upsertSiteForWebMonitor(body: { appId: string; projectId: string; systemName: string }) {
    const result = await this.models
      .System()
      .findOneAndUpdate(
        { appId: body.appId },
        { $set: { projectId: body.projectId, systemName: body.systemName, type: "web" } },
        { upsert: true, new: true },
      )
      .exec();
    await this.updateSiteNodeCache(body.appId);
    return result;
  }

  async getSiteForDb(appId: string) {
    if (!appId) throw new Error("Query a system: appId must not be empty");
    return await this.models.System().findOne({ appId: appId }).exec();
  }

  async getSitesForUserId(query: Record<string, unknown>) {
    const { systemName, type, projectId } = query;
    const param: Record<string, unknown> = {};
    if (systemName) param.systemName = new RegExp(String(systemName));
    if (type) param.type = type;
    if (projectId) param.projectId = projectId;
    return (await this.models.System().find(param).exec()) || [];
  }

  async getSiteForAppId(appId: string) {
    if (!appId) throw new Error("Query a system: appId must not be empty");
    const cached = this.nodeCache.getAppInfo(appId);
    if (cached) return cached;
    // Cache miss (cold start, or a site created outside the API): fall back to
    // Mongo and backfill so ingest never rejects a legitimate appId with a 500.
    const system = await this.getSiteForDb(appId);
    if (system) this.nodeCache.updateSiteCache(system);
    return system;
  }

  async getSiteList() {
    return (await this.models.System().find({}).exec()) || [];
  }

  async getWebSiteList() {
    return (await this.models.System().find({ type: "web" }).exec()) || [];
  }

  async deleteWebSiteUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appId: appId }, { $pull: { userId: userToken } }, { multi: true })
      .exec();
  }
  async addWebSiteUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appId: appId }, { $push: { userId: userToken } }, { multi: true })
      .exec();
  }

  async deleteSite(appId: string, type: string): Promise<DeleteResult> {
    const result = await this.models.System().deleteOne({ appId: appId, type }).exec();
    this.nodeCache.removeAppInfo(appId);
    return result;
  }
}
