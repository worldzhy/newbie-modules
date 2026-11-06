import { Injectable } from "@nestjs/common";
import { DeleteResult } from "mongodb";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { WebMonitorModelsService } from "../../models/mongo/web-monitor-models.service";
import { NodeCacheService } from "../../shared/node-cache.service";
import { func } from "../../shared/utils";

@Injectable()
export class SiteService {
  constructor(
    private readonly models: WebMonitorModelsService,
    private readonly nodeCache: NodeCacheService,
    private readonly prisma: PrismaService,
  ) {}

  /** Project IDs the caller is a member of. Empty means "no projects". */
  private async userProjectIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

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

    // The appKey is a storage partition key and must never be caller-supplied:
    // mint it here. The installation-sync path (upsertSiteForWebMonitor)
    // backfills it from the credential's immutable appKey instead.
    const appKey = func.randomString(7).slice(0, 7);
    const SystemModel = this.models.System();
    const system = new SystemModel();
    system.projectId = String(body.projectId);
    system.systemDomain = typeof body.systemDomain === "string" ? body.systemDomain : "";
    system.systemName = String(body.systemName);
    system.type = type || "web";
    system.appId = appKey;
    system.userId = [typeof body.token === "string" ? body.token : ""];
    system.createTime = new Date();
    system.slowPageTime = Number(body.slowPageTime) || 5;
    system.slowWhiteTime = Number(body.slowWhiteTime) || 2;
    system.slowJsTime = Number(body.slowJsTime) || 2;
    system.slowCssTime = Number(body.slowCssTime) || 2;
    system.slowImgTime = Number(body.slowImgTime) || 2;
    system.slowAjaxTime = Number(body.slowAjaxTime) || 2;

    const result = await system.save();
    await this.updateSiteNodeCache(appKey);
    return func.result({ data: result });
  }

  async updateSiteData(body: Record<string, unknown>) {
    const appKey = body.appId;
    if (!appKey) return func.errResult({ desc: "Update system: appKey must not be empty" });
    const appIdStr = String(appKey);

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
    const result = await this.models.System().updateOne({ appKey: appIdStr }, update, { multi: true }).exec();
    await this.updateSiteNodeCache(appIdStr);
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
  async upsertSiteForWebMonitor(body: { appKey: string; projectId: string; systemName: string }) {
    const result = await this.models
      .System()
      .findOneAndUpdate(
        { appKey: body.appId },
        { $set: { projectId: body.projectId, systemName: body.systemName, type: "web" } },
        { upsert: true, new: true },
      )
      .exec();
    await this.updateSiteNodeCache(body.appId);
    return result;
  }

  async getSiteForDb(appKey: string) {
    if (!appKey) throw new Error("Query a system: appKey must not be empty");
    return await this.models.System().findOne({ appKey: appKey }).exec();
  }

  async getSitesForUserId(query: Record<string, unknown>, userId: string) {
    const { systemName, type, projectId } = query;
    const param: Record<string, unknown> = {};
    if (systemName) param.systemName = new RegExp(func.escapeRegExp(systemName));
    if (type) param.type = type;
    const projectIds = await this.userProjectIds(userId);
    // Restrict to the caller's projects; an explicit projectId filter is honoured
    // only when it is one of the caller's own projects.
    if (projectId && projectIds.includes(String(projectId))) {
      param.projectId = projectId;
    } else {
      param.projectId = { $in: projectIds };
    }
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

  /** List web sites belonging to projects the caller is a member of. */
  async getWebSiteListForUser(userId: string) {
    const projectIds = await this.userProjectIds(userId);
    return (
      (await this.models
        .System()
        .find({ type: "web", projectId: { $in: projectIds } })
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
