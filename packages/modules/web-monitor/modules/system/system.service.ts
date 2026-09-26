import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../models/mongo/monitor-models.service';
import {NodeCacheService} from '../../shared/node-cache.service';
import {func} from '../../shared/utils';

@Injectable()
export class SystemService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly nodeCache: NodeCacheService
  ) {}

  async saveSystemData(body: any) {
    const type = body.type;
    if (!body.projectId) return func.errResult({desc: '新增系统必须属于某个项目'});
    if (!body.systemDomain && type === 'web') return func.errResult({desc: '新增系统信息操作：系统域名不能为空'});
    if (!body.systemName) return func.errResult({desc: '新增系统信息操作：系统名称不能为空'});

    if (type === 'web') {
      const search = await this.models.System().findOne({systemDomain: body.systemDomain}).exec();
      if (search && search.systemDomain) return func.errResult({desc: '新增系统信息操作：系统已存在'});
    }

    const appId = body.appId ? body.appId : func.randomString();
    const SystemModel = this.models.System();
    const system = new SystemModel();
    system.projectId = body.projectId;
    system.systemDomain = body.systemDomain;
    system.systemName = body.systemName;
    system.type = body.type;
    system.appId = appId;
    system.userId = [body.token || ''];
    system.createTime = new Date();
    system.isUse = body.isUse;
    system.slowPageTime = body.slowPageTime || 5;
    system.slowJsTime = body.slowJsTime || 2;
    system.slowCssTime = body.slowCssTime || 2;
    system.slowImgTime = body.slowImgTime || 2;
    system.slowAjaxTime = body.slowAjaxTime || 2;
    system.isStatisiPages = body.isStatisiPages;
    system.isStatisiAjax = body.isStatisiAjax;
    system.isStatisiResource = body.isStatisiResource;
    system.isStatisiSystem = body.isStatisiSystem;
    system.isStatisiError = body.isStatisiError;
    system.isWarning = body.isWarning;

    const result = await system.save();
    await this.updateSystemNodeCache(appId);
    return func.result({data: result});
  }

  async updateSystemData(body: any) {
    const appId = body.appId;
    if (!appId) return func.errResult({desc: '更新系统信息操作：appId不能为空'});

    const update = {
      $set: {
        isUse: body.isUse || 0,
        systemName: body.systemName || '',
        systemDomain: body.systemDomain || '',
        slowPageTime: body.slowPageTime || 5,
        slowJsTime: body.slowJsTime || 2,
        type: body.type || 'web',
        slowCssTime: body.slowCssTime || 2,
        slowImgTime: body.slowImgTime || 2,
        slowAjaxTime: body.slowAjaxTime || 2,
        isStatisiPages: body.isStatisiPages || 0,
        isStatisiAjax: body.isStatisiAjax || 0,
        isStatisiResource: body.isStatisiResource || 0,
        isStatisiSystem: body.isStatisiSystem || 0,
        isStatisiError: body.isStatisiError || 0,
        isDailyUse: body.isDailyUse || 0,
        isWarning: body.isWarning || 0,
      },
    };
    const result = await this.models.System().updateOne({appId: appId}, update, {multi: true}).exec();
    await this.updateSystemNodeCache(appId);
    return func.result({data: result});
  }

  async updateSystemNodeCache(appId: string) {
    const system = await this.getSystemForDb(appId);
    this.nodeCache.updateSystemCache(system as any);
  }

  /**
   * Upserts the Mongo System document backing a WEB_MONITOR agent.
   * The document carries the collection thresholds/switches (config truth source
   * stays in Mongo); appId equals the agent's immutable appKey. Idempotent by
   * appId so it can be safely retried after the PG-side agent issuance.
   */
  async upsertSystemForWebAgent(body: {appId: string; projectId: string; systemName: string}) {
    const result = await this.models
      .System()
      .findOneAndUpdate(
        {appId: body.appId},
        {$set: {projectId: body.projectId, systemName: body.systemName, type: 'web', isUse: 0}},
        {upsert: true, new: true}
      )
      .exec();
    await this.updateSystemNodeCache(body.appId);
    return result;
  }

  async getSystemForDb(appId: string) {
    if (!appId) throw new Error('查询某个系统信：appId不能为空');
    return (await this.models.System().findOne({appId: appId}).exec()) || ({} as any);
  }

  async getSysForUserId(query: any) {
    const {isWarning, systemName, type, projectId} = query;
    const param: any = {};
    if (isWarning) param.isWarning = parseInt(isWarning);
    if (systemName) param.systemName = new RegExp(systemName);
    if (type) param.type = type;
    if (projectId) param.projectId = projectId;
    return (await this.models.System().find(param).exec()) || [];
  }

  async getSystemForAppId(appId: string) {
    if (!appId) throw new Error('查询某个系统信：appId不能为空');
    return this.nodeCache.getAppInfo(appId) || ({} as any);
  }

  async getSysForAlarm() {
    return (await this.models.System().find({isWarning: 1}).read('secondaryPreferred').exec()) || [];
  }

  async getSysForDaily() {
    return (await this.models.System().find({isDailyUse: 0}).read('secondaryPreferred').exec()) || [];
  }

  async getSystemList() {
    return (await this.models.System().find({}).exec()) || [];
  }

  async getWebSystemList() {
    return (await this.models.System().find({type: 'web'}).exec()) || [];
  }

  async deleteWebSystemUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({appId: appId}, {$pull: {userId: userToken}}, {multi: true})
      .exec();
  }
  async addWebSystemUser(appId: string, userToken: string) {
    return this.models
      .System()
      .updateOne({appId: appId}, {$push: {userId: userToken}}, {multi: true})
      .exec();
  }

  async deleteSystem(appId: string, type: string): Promise<any> {
    return this.models.System().deleteOne({appId: appId, type}).exec();
  }

  async handleDaliyEmail(appId: string, email: string, type: number, _handleEmali = true, item = 1) {
    const system = await this.getSystemForDb(appId);
    if (!system) throw new Error('appId无效');
    const listKey: 'daliyList' | 'highestList' = item === 2 ? 'highestList' : 'daliyList';
    const update = type === 1 ? {$addToSet: {[listKey]: email}} : {$pull: {[listKey]: email}};
    return this.models.System().updateOne({appId: appId}, update, {multi: true}).exec();
  }

  async updateEmailSystemIds(emailAddr: string, appId: string, handletype = 1, handleitem = 1) {
    let str = '';
    let type = '';
    if (handleitem === 1) {
      str = '每日发送日报权限';
      type = 'daliy';
    } else if (handleitem === 2) {
      str = '超过历史流量峰值邮件触达';
      type = 'highest';
    }
    const handleData =
      handletype === 1
        ? {
            $push: {
              systemIds: {$each: [{systemId: appId, desc: str, type}]},
            },
          }
        : {$pull: {systemIds: {systemId: appId, type}}};
    return this.models.Email().updateOne({email: emailAddr}, handleData, {multi: true}).exec();
  }
}
