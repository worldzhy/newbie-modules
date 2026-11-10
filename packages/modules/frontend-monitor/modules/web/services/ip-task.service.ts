import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FrontendMonitorModelsService } from "../../../models/mongo/frontend-monitor-models.service";
import { RedisService } from "@modules/redis/redis.service";
import { SiteService } from "@modules/frontend-monitor/modules/site/site.service";
import { func } from "../../../shared/utils";
import { FRONTEND_MONITOR_CONFIG } from "../../../shared/frontend-monitor-config";
import https from "https";
import { RedisKeyPrefix } from "../../../models/enum";
import { WebEnvironmentDocument } from "../../../models/mongo/web/web-environment.schema";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";

interface TencentIpResponse {
  status: number;
  result: { ad_info: { province: string; city: string } };
}

@Injectable()
export class FrontendIpTaskService {
  private cfg: Record<string, unknown>;
  private readonly logger = new Logger(FrontendIpTaskService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly models: FrontendMonitorModelsService,
    private readonly redis: RedisService,
    private readonly site: SiteService,
  ) {
    this.cfg = this.config.get("modules.frontend-monitor") || {};
  }

  async saveWebGetIpDatas() {
    const systems = await this.site.getWebSiteList();
    if (!systems || !systems.length) return;
    for (const sys of systems) {
      const appKey = sys.appKey;
      if (!appKey) continue;
      await this.saveWebGetIpDatasByOne(appKey);
    }
  }

  private async saveWebGetIpDatasByOne(appKey: string) {
    try {
      const query: Record<string, unknown> = { city: { $exists: false } };
      const beginTime = await this.redis.getClient().get(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appKey}`);
      query.createTime = {
        $gt: beginTime ? new Date(beginTime) : new Date(Date.now() - FRONTEND_MONITOR_CONFIG.ip_task_space_time),
      };
      const ipThread = FRONTEND_MONITOR_CONFIG.ip_thread;
      const datas = await this.models
        .WebEnvironment(appKey)
        .find(query)
        .read("secondaryPreferred")
        .limit(ipThread * 60)
        .sort({ createTime: 1 })
        .exec();
      if (datas && datas.length) {
        for (let i = 0; i < ipThread; i++) {
          const newSpit = datas.splice(0, 60);
          await this.handleDatas(appKey, newSpit, datas.length);
        }
      } else {
        await this.redis.getClient().set(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appKey}`, new Date().toString());
      }
    } catch (err) {
      this.logger.error("saveWebGetIpDatasByOne failed", getErrorMessage(err));
    }
  }

  private async handleDatas(appKey: string, data: WebEnvironmentDocument[], lastLen: number) {
    if (!data || !data.length) return;
    for (let i = 0; i < data.length; i++) {
      const ip = data[i].ip;
      await this.getIpData(ip, String(data[i]._id), data[i].appKey);
    }
    if (lastLen === 0) {
      await this.redis
        .getClient()
        .set(`${RedisKeyPrefix.IP_TASK_BEGIN_TIME}${appKey}`, String(data[data.length - 1].createTime));
    }
  }

  private async getIpData(ip: string, _id: string, appKey: string) {
    const _copyip = ip.split(".");
    const copyip = `${_copyip[0]}.${_copyip[1]}.${_copyip[2]}`;
    const datas = await this.redis.getClient().get(`${RedisKeyPrefix.IP_GEO_CACHE}${copyip}`);
    if (datas) {
      try {
        const json = JSON.parse(datas);
        return await this.updateWebEnvironment(json, _id, appKey);
      } catch {
        // Expected failure: the cached value may be corrupt — refetch from the Tencent API.
      }
    }
    return await this.getIpDataByTencentApi(ip, _id, copyip, appKey);
  }

  private httpGetJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on("error", reject);
    });
  }

  private async getIpDataByTencentApi(ip: string, _id: string, copyip: string, appKey: string) {
    if (func.isSkipIp(ip) || !this.cfg.TENCENTMAPKEY) return;
    try {
      const url = `https://apis.map.qq.com/ws/location/v1/ip?ip=${ip}&key=${String(this.cfg.TENCENTMAPKEY)}`;
      const result = await this.httpGetJson<TencentIpResponse>(url);
      if (result?.status === 0 && result?.result) {
        const json = {
          _ip: ip,
          province: result.result.ad_info.province,
          city: result.result.ad_info.city,
        };
        await this.redis
          .getClient()
          .set(
            `${RedisKeyPrefix.IP_GEO_CACHE}${copyip}`,
            JSON.stringify(json),
            "EX",
            FRONTEND_MONITOR_CONFIG.ipRedisTTL,
          );
        return await this.updateWebEnvironment(json, _id, appKey);
      }
      return {};
    } catch (err) {
      this.logger.error(`Tencent API call error: ${getErrorMessage(err)}`);
      return {};
    }
  }

  private async updateWebEnvironment(data: Record<string, unknown>, id: string, appKey: string) {
    return await this.models
      .WebEnvironment(appKey)
      .updateOne({ _id: id }, { $set: { province: data.province, city: data.city } }, { upsert: true })
      .exec();
  }
}
