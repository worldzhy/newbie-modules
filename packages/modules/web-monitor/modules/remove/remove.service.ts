import { Injectable } from "@nestjs/common";
import dayjs from "dayjs";
import { MonitorModelsService } from "../../models/mongo/monitor-models.service";
import { MonitorClickhouseService } from "../../models/clickhouse/monitor-clickhouse.service";

type WebResourceType = "ajax" | "page" | "env" | "err" | "resource";

interface CustomDeleteFilter {
  appId: string;
  type?: string;
  resource?: WebResourceType[];
  time?: (string | number | Date)[];
}

@Injectable()
export class RemoveService {
  constructor(
    private readonly models: MonitorModelsService,
    private readonly clickhouse: MonitorClickhouseService,
  ) {}

  async customDelete(fil: CustomDeleteFilter) {
    const { appId, type = "", resource = [], time = [] } = fil;
    if (!time.length) {
      throw new Error("A time must be selected");
    }

    const startTime = dayjs(new Date(time[0]).valueOf()).format("YYYY-MM-DD 00:00:00");
    const endTime = dayjs(new Date(time[1]).valueOf()).format("YYYY-MM-DD 23:59:59");
    // Use createTime for Mongo queries (camelCase in new schema)
    const query = {
      createTime: { $lte: new Date(endTime), $gte: new Date(startTime) },
    };

    if (type !== "web" || !resource.length) {
      return null;
    }

    const chWhere = `createTime<=toDateTime('${endTime}') and createTime>=toDateTime('${startTime}')`;
    const deletions: Promise<unknown>[] = [];

    for (const item of resource) {
      switch (item) {
        case "ajax": {
          const ajaxModel = await this.clickhouse.WebAjax(appId);
          deletions.push(ajaxModel.delete({ where: chWhere }));
          break;
        }
        case "page":
          deletions.push(this.models.WebPage(appId).deleteMany(query).exec());
          break;
        case "env":
          deletions.push(this.models.WebEnvironment(appId).deleteMany(query).exec());
          break;
        case "err": {
          const errorModel = await this.clickhouse.WebError(appId);
          deletions.push(errorModel.delete({ where: chWhere }));
          break;
        }
        case "resource":
          deletions.push(this.models.WebResource(appId).deleteMany(query).exec());
          break;
      }
    }

    return await Promise.all(deletions);
  }
}
