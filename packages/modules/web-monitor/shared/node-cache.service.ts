import {Injectable} from '@nestjs/common';
import {SystemDocument} from '../models/mongo/system.schema';

@Injectable()
export class NodeCacheService {
  private appInfo = new Map<string, SystemDocument>();

  getAppInfo(appId: string) {
    if (!appId) throw new Error('查询应用信息：appId不能为空');
    return this.appInfo.get(appId);
  }

  setAppInfo(appId: string, system: SystemDocument) {
    if (!appId) throw new Error('设置应用信息：appId不能为空');
    this.appInfo.set(appId, system);
  }

  updateAllSystemCache(systems: SystemDocument[]) {
    systems.forEach(system => {
      this.updateSystemCache(system);
    });
  }

  updateSystemCache(system: SystemDocument) {
    this.setAppInfo(system.appId, system);
  }
}
