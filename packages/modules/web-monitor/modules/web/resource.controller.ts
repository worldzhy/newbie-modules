import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {ResourceService} from './services/resource.service';

@ApiTags('Frontend Monitor / Web / Resource')
@Controller('/api/v1/resource')
export class ResourceController {
  constructor(private readonly resourceSrv: ResourceService) {}

  @Get('/getResourceForType')
  @ApiOperation({summary: 'Get resource performance list by type'})
  @ApiResponse({type: Object})
  async getResourceForType(@Query() q: any) {
    const {appId, url, type = 1, pageNo = 1, pageSize = 15, beginTime, endTime} = q;
    if (!appId) throw new Error('Single page resource performance list: appId must not be empty');
    if (!url) throw new Error('Single page resource performance list: url must not be empty');
    const result = await this.resourceSrv.getResourceForType(
      appId,
      url,
      Number(type),
      Number(pageNo),
      Number(pageSize),
      beginTime,
      endTime
    );
    return func.result({data: result});
  }

  @Get('/getAverageResourceList')
  @ApiOperation({summary: 'Get average resource performance list'})
  @ApiResponse({type: Object})
  async getAverageResourceList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('Get resource average performance list: appId must not be empty');
    const result = await this.resourceSrv.getAverageResourceList(q);
    return func.result({data: result});
  }

  @Get('/getOneResourceAvg')
  @ApiOperation({summary: 'Get single resource average performance'})
  @ApiResponse({type: Object})
  async getOneResourceAvg(@Query() q: any) {
    const {appId, url, beginTime, endTime} = q;
    if (!appId) throw new Error('Single resource average performance data: appId must not be empty');
    if (!url) throw new Error('Single resource average performance data: api url must not be empty');
    const result = await this.resourceSrv.getOneResourceAvg(appId, url, beginTime, endTime);
    return func.result({data: result});
  }

  @Get('/getOneResourceList')
  @ApiOperation({summary: 'Get single resource performance list'})
  @ApiResponse({type: Object})
  async getOneResourceList(@Query() q: any) {
    const {appId, url, pageNo = 1, pageSize = 15, beginTime, endTime} = q;
    if (!appId) throw new Error('Single resource performance list data: appId must not be empty');
    if (!url) throw new Error('Single resource performance list data: api url must not be empty');
    const result = await this.resourceSrv.getOneResourceList(
      appId,
      url,
      Number(pageNo),
      Number(pageSize),
      beginTime,
      endTime
    );
    return func.result({data: result});
  }

  @Get('/getOneResourceDetail')
  @ApiOperation({summary: 'Get single resource details'})
  @ApiResponse({type: Object})
  async getOneResourceDetail(@Query() q: any) {
    const {appId, id} = q;
    if (!id) throw new Error('Get single resource details: id must not be empty');
    if (!appId) throw new Error('Get single resource details: appId must not be empty');
    const row = await this.resourceSrv.getOneResourceDetail(appId, id);
    return func.result({data: row || {}});
  }
}
