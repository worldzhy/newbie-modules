import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';
import {RedisService} from '../../../models/redis/redis.service';
import {SystemService} from '../../../modules/system/system.service';
import {func} from '../../../shared/utils';
import https from 'https';
import {RedisKeyPrefix} from '../../../models/enum';

@Injectable()
export class WebIpTaskService {
  private cfg: any;
  constructor(
    private readonly config: ConfigService,
    private readonly models: MonitorModelsService,
    private readonly redis: RedisService,
    private readonly system: SystemService
  ) {
    this.cfg = this.config.get('modules.web-monitor');
  }

  async saveWebGetIpDatas() {
    const systems = await this.system.getWebSystemList();
    if (!systems || !systems.length) return;
    for (const sys of systems) {
      const appId = sys.appId;
      if (!appId || sys.isUse !== 0) continue;
      await this.saveWebGetIpDatasByOne(appId);
    }
  }

  private async saveWebGetIpDatasByOne(appId: string) {
    try {
      const query: any = {city: {$exists: false}};
      const beginTime = await this.redis.get(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appId}`);
      query.createTime = {
        $gt: beginTime ? new Date(beginTime) : new Date(Date.now() - this.cfg.ip_task_space_time),
      };
      const datas = await this.models
        .WebEnvironment(appId)
        .find(query)
        .read('secondaryPreferred')
        .limit(this.cfg.ip_thread * 60)
        .sort({createTime: 1})
        .exec();
      if (datas && datas.length) {
        for (let i = 0; i < this.cfg.ip_thread; i++) {
          const newSpit = datas.splice(0, 60);
          await this.handleDatas(appId, newSpit, datas.length);
        }
      } else {
        await this.redis.set(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appId}`, new Date().toString());
      }
    } catch (err) {
      console.log(err);
    }
  }

  private async handleDatas(appId: string, data: any[], lastLen: number) {
    if (!data || !data.length) return;
    for (let i = 0; i < data.length; i++) {
      const ip = data[i].ip;
      await this.getIpData(ip, data[i]._id, data[i].appId);
    }
    if (lastLen === 0) {
      await this.redis.set(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appId}`, data[data.length - 1].createTime);
    }
  }

  private async getIpData(ip: string, _id: string, appId: string) {
    let _copyip = ip.split('.');
    const copyip = `${_copyip[0]}.${_copyip[1]}.${_copyip[2]}`;
    let datas = await this.redis.get(copyip);
    if (datas) {
      try {
        const json = JSON.parse(datas);
        return await this.updateWebEnvironment(json, _id, appId);
      } catch {
        // Expected failure: the cached value may be corrupt — refetch from the Tencent API.
      }
    }
    return await this.getIpDataByTencentApi(ip, _id, copyip, appId);
  }

  private httpGetJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https
        .get(url, res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', reject);
    });
  }

  private async getIpDataByTencentApi(ip: string, _id: string, copyip: string, appId: string) {
    if (func.isSkipIp(ip) || !this.cfg.TENCENTMAPKEY) return;
    try {
      const url = `https://apis.map.qq.com/ws/location/v1/ip?ip=${ip}&key=${this.cfg.TENCENTMAPKEY}`;
      const result: any = await this.httpGetJson(url);
      if (result?.status === 0 && result?.result) {
        const json = {
          _ip: ip,
          province: result.result.ad_info.province,
          city: result.result.ad_info.city,
        };
        await this.redis.set(copyip, JSON.stringify(json), 'EX', this.cfg.ipRedisTTL);
        return await this.updateWebEnvironment(json, _id, appId);
      }
      return {};
    } catch (err) {
      console.log(`调用腾讯api发现了错误${err}`);
      return {};
    }
  }

  private async updateWebEnvironment(data: any, id: string, appId: string) {
    return await this.models
      .WebEnvironment(appId)
      .updateOne({_id: id}, {$set: {province: data.province, city: data.city}}, {upsert: true})
      .exec();
  }
}
