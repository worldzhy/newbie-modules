import { Injectable } from "@nestjs/common";
import { WebMonitorModelsService } from "../../../models/mongo/web-monitor-models.service";
import { func } from "../../../shared/utils";

@Injectable()
export class WebCustomService {
  constructor(private readonly models: WebMonitorModelsService) {}

  async getCustomFilterList(appKey: string) {
    const rows = await this.models
      .WebCustomFilter(appKey)
      .find()
      .sort({ createTime: -1 })
      .read("secondaryPreferred")
      .exec();
    return { list: rows || [] };
  }

  async addCustomFilter(appKey: string, filterKey: string, filterDesc: string) {
    if (!filterKey) throw new Error("Add filter: filterKey must not be empty");
    if (!appKey) throw new Error("Add filter: appKey must not be empty");
    if (!filterDesc) throw new Error("Add filter: filterDesc must not be empty");
    const model = this.models.WebCustomFilter(appKey);
    const exists = await model.findOne({ filterKey }).exec();
    if (exists && exists.filterKey) throw new Error("Add filter: filterKey already exists");
    const doc = new model();
    doc.appId = appKey;
    doc.filterKey = filterKey;
    doc.filterDesc = filterDesc;
    await doc.save();
    return true;
  }

  async delCustomFilter(appKey: string, id: string) {
    if (!id) throw new Error("Delete filter: _id must not be empty");
    if (!appKey) throw new Error("Delete filter: appKey must not be empty");
    const model = this.models.WebCustomFilter(appKey);
    try {
      await model.findOne({ _id: id }).exec();
    } catch {
      throw new Error("Delete filter: _id does not exist");
    }
    try {
      await model.deleteOne({ _id: id }).exec();
      return true;
    } catch {
      throw new Error("Delete filter: deletion failed");
    }
  }

  async getAverageCustomList(
    appKey: string,
    pageNo: number,
    pageSize: number,
    beginTime?: string,
    endTime?: string,
    customName?: string,
    customFilter?: Record<string, unknown>,
  ) {
    const filter: Record<string, unknown> = {};
    if (customName) filter.customName = { $regex: func.escapeRegExp(customName), $options: "i" };
    const createTime: Record<string, unknown> = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime);
      filter.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime);
      filter.createTime = createTime;
    }
    if (customFilter && Object.prototype.toString.apply(customFilter) === "[object Object]") {
      Object.keys(customFilter).forEach((key) => {
        if (customFilter[key] !== null && customFilter[key] !== "" && typeof customFilter[key] !== "undefined") {
          filter[`customFilter.${key}`] = { $regex: func.escapeRegExp(customFilter[key]), $options: "i" };
        }
      });
    }
    const model = this.models.WebCustom(appKey);
    const totalNum = await model.count(filter).read("secondaryPreferred").exec();
    const dataList = await model
      .find(filter)
      .skip((Number(pageNo) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .sort({ createTime: -1 })
      .read("secondaryPreferred")
      .exec();
    return { totalNum, dataList, pageNo: Number(pageNo) };
  }
}
