import { Injectable } from "@nestjs/common";
import { MonitorModelsService } from "../../models/mongo/monitor-models.service";
import { NodeCacheService } from "../../shared/node-cache.service";
import { func } from "../../shared/utils";

@Injectable()
export class SystemService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly nodeCache: NodeCacheService,
  ) {}

  async saveSystemData(body: any) {
    const type = body.type;
    if (!body.projectId) return func.errResult({ desc: "A new system must belong to a project" });
    if (!body.systemDomain && type === "web")
      return func.errResult({ desc: "Add system: system domain must not be empty" });
    if (!body.systemName) return func.errResult({ desc: "Add system: system name must not be empty" });

    if (type === "web") {
      const search = await this.models.System().findOne({ systemDomain: body.systemDomain }).exec();
      if (search && search.systemDomain) return func.errResult({ desc: "Add system: system already exists" });
    }

    const appId = body.appId ? body.appId : func.randomString();
    const SystemModel = this.models.System();
    const system = new SystemModel();
    system.projectId = body.projectId;
    system.systemDomain = body.systemDomain;
    system.systemName = body.systemName;
    system.type = body.type;
    system.appId = appId;
    system.userId = [body.token || ""];
    system.createTime = new Date();
    system.slowPageTime = body.slowPageTime || 5;
    system.slowJsTime = body.slowJsTime || 2;
    system.slowCssTime = body.slowCssTime || 2;
    system.slowImgTime = body.slowImgTime || 2;
    system.slowAjaxTime = body.slowAjaxTime || 2;

    const result = await system.save();
    await this.updateSystemNodeCache(appId);
    return func.result({ data: result });
  }

  async updateSystemData(body: any) {
    const appId = body.appId;
    if (!appId) return func.errResult({ desc: "Update system: appId must not be empty" });

    const update = {
      $set: {
        systemName: body.systemName || "",
        systemDomain: body.systemDomain || "",
        slowPageTime: body.slowPageTime || 5,
        slowJsTime: body.slowJsTime || 2,
        type: body.type || "web",
        slowCssTime: body.slowCssTime || 2,
        slowImgTime: body.slowImgTime || 2,
        slowAjaxTime: body.slowAjaxTime || 2,
      },
    };
    const result = await this.models.System().updateOne({ appId: appId }, update, { multi: true }).exec();
    await this.updateSystemNodeCache(appId);
    return func.result({ data: result });
  }

  async updateSystemNodeCache(appId: string) {
    const system = await this.getSystemForDb(appId);
    this.nodeCache.updateSystemCache(system as any);
  }

  /**
   * Upserts the Mongo System document backing a WEB_MONITOR agent.
   * The document carries the anomaly detection thresholds (config truth source
   * stays in Mongo); appId equals the agent's immutable appKey. Idempotent by
   * appId so it can be safely retried after the PG-side agent issuance.
   */
  async upsertSystemForWebAgent(body: { appId: string; projectId: string; systemName: string }) {
    const result = await this.models
      .System()
      .findOneAndUpdate(
        { appId: body.appId },
        { $set: { projectId: body.projectId, systemName: body.systemName, type: "web" } },
        { upsert: true, new: true },
      )
      .exec();
    await this.updateSystemNodeCache(body.appId);
    return result;
  }

  async getSystemForDb(appId: string) {
    if (!appId) throw new Error("Query a system: appId must not be empty");
    return (await this.models.System().findOne({ appId: appId }).exec()) || ({} as any);
  }

  async getSysForUserId(query: any) {
    const { systemName, type, projectId } = query;
    const param: any = {};
    if (systemName) param.systemName = new RegExp(systemName);
    if (type) param.type = type;
    if (projectId) param.projectId = projectId;
    return (await this.models.System().find(param).exec()) || [];
  }

  async getSystemForAppId(appId: string) {
    if (!appId) throw new Error("Query a system: appId must not be empty");
    return this.nodeCache.getAppInfo(appId) || ({} as any);
  }

  async getSystemList() {
    return (await this.models.System().find({}).exec()) || [];
  }

  async getWebSystemList() {
    return (await this.models.System().find({ type: "web" }).exec()) || [];
  }

  async deleteWebSystemUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appId: appId }, { $pull: { userId: userToken } }, { multi: true })
      .exec();
  }
  async addWebSystemUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({ appId: appId }, { $push: { userId: userToken } }, { multi: true })
      .exec();
  }

  async deleteSystem(appId: string, type: string): Promise<any> {
    return this.models.System().deleteOne({ appId: appId, type }).exec();
  }
}
