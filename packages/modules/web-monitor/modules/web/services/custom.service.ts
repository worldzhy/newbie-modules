import {Injectable} from '@nestjs/common';
import {MonitorModelsService} from '../../../models/mongo/monitor-models.service';

@Injectable()
export class WebCustomService {
  constructor(private readonly models: MonitorModelsService) {}

  async getCustomFilterList(appId: string) {
    const rows = await this.models
      .WebCustomFilter(appId)
      .find()
      .sort({createTime: -1})
      .read('secondaryPreferred')
      .exec();
    return {list: rows || []};
  }

  async addCustomFilter(appId: string, filterKey: string, filterDesc: string) {
    if (!filterKey) throw new Error('Add filter: filterKey must not be empty');
    if (!appId) throw new Error('Add filter: appId must not be empty');
    if (!filterDesc) throw new Error('Add filter: filterDesc must not be empty');
    const model = this.models.WebCustomFilter(appId);
    const exists = await model.findOne({filterKey}).exec();
    if (exists && exists.filterKey) throw new Error('Add filter: filterKey already exists');
    const doc = new model();
    doc.appId = appId;
    doc.filterKey = filterKey;
    doc.filterDesc = filterDesc;
    await doc.save();
    return true;
  }

  async delCustomFilter(appId: string, id: string) {
    if (!id) throw new Error('Delete filter: _id must not be empty');
    if (!appId) throw new Error('Delete filter: appId must not be empty');
    const model = this.models.WebCustomFilter(appId);
    try {
      await model.findOne({_id: id}).exec();
    } catch {
      throw new Error('Delete filter: _id does not exist');
    }
    try {
      await model.deleteOne({_id: id}).exec();
      return true;
    } catch {
      throw new Error('Delete filter: deletion failed');
    }
  }

  async getAverageCustomList(
    appId: string,
    pageNo: number,
    pageSize: number,
    beginTime?: string,
    endTime?: string,
    customName?: string,
    customFilter?: Record<string, any>
  ) {
    const filter: any = {};
    if (customName) filter.customName = {$regex: customName, $options: 'i'};
    const createTime: any = {};
    if (beginTime) {
      createTime.$gte = new Date(beginTime);
      filter.createTime = createTime;
    }
    if (endTime) {
      createTime.$lte = new Date(endTime);
      filter.createTime = createTime;
    }
    if (customFilter && Object.prototype.toString.apply(customFilter) === '[object Object]') {
      Object.keys(customFilter).forEach(key => {
        if (customFilter[key] !== null && customFilter[key] !== '' && typeof customFilter[key] !== 'undefined') {
          filter[`customFilter.${key}`] = {$regex: customFilter[key], $options: 'i'};
        }
      });
    }
    const model = this.models.WebCustom(appId);
    const totalNum = await model.count(filter).read('secondaryPreferred').exec();
    const dataList = await model
      .find(filter)
      .skip((Number(pageNo) - 1) * Number(pageSize))
      .limit(Number(pageSize))
      .sort({createTime: -1})
      .read('secondaryPreferred')
      .exec();
    return {totalNum, dataList, pageNo: Number(pageNo)};
  }
}
