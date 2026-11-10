import { Injectable } from "@nestjs/common";
import { SystemDocument } from "../models/mongo/system.schema";

@Injectable()
export class NodeCacheService {
  private appInfo = new Map<string, SystemDocument>();

  getAppInfo(appKey: string) {
    if (!appKey) throw new Error("Get app info: appKey must not be empty");
    return this.appInfo.get(appKey);
  }

  setAppInfo(appKey: string, system: SystemDocument) {
    if (!appKey) throw new Error("Set app info: appKey must not be empty");
    this.appInfo.set(appKey, system);
  }

  removeAppInfo(appKey: string) {
    this.appInfo.delete(appKey);
  }

  updateAllSiteCache(systems: SystemDocument[]) {
    // Reconcile, not just upsert: evict entries whose site no longer exists so
    // deleted sites stop accepting ingest after the next refresh.
    const liveAppIds = new Set(systems.map((system) => system.appKey));
    for (const cachedAppId of [...this.appInfo.keys()]) {
      if (!liveAppIds.has(cachedAppId)) this.appInfo.delete(cachedAppId);
    }
    systems.forEach((system) => {
      this.updateSiteCache(system);
    });
  }

  updateSiteCache(system: SystemDocument) {
    this.setAppInfo(system.appKey, system);
  }
}
