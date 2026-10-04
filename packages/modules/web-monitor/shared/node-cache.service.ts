import { Injectable } from "@nestjs/common";
import { SystemDocument } from "../models/mongo/system.schema";

@Injectable()
export class NodeCacheService {
  private appInfo = new Map<string, SystemDocument>();

  getAppInfo(appId: string) {
    if (!appId) throw new Error("Get app info: appId must not be empty");
    return this.appInfo.get(appId);
  }

  setAppInfo(appId: string, system: SystemDocument) {
    if (!appId) throw new Error("Set app info: appId must not be empty");
    this.appInfo.set(appId, system);
  }

  removeAppInfo(appId: string) {
    this.appInfo.delete(appId);
  }

  updateAllSiteCache(systems: SystemDocument[]) {
    // Reconcile, not just upsert: evict entries whose site no longer exists so
    // deleted sites stop accepting ingest after the next refresh.
    const liveAppIds = new Set(systems.map((system) => system.appId));
    for (const cachedAppId of [...this.appInfo.keys()]) {
      if (!liveAppIds.has(cachedAppId)) this.appInfo.delete(cachedAppId);
    }
    systems.forEach((system) => {
      this.updateSiteCache(system);
    });
  }

  updateSiteCache(system: SystemDocument) {
    this.setAppInfo(system.appId, system);
  }
}
