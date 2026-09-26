import {Controller, Get, Post, Body, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {WebCustomService} from './services/custom.service';
import {WebMonitorCustomAverageListResponseDto, WebMonitorCustomFilterListResponseDto} from './custom.dto';

@ApiTags('Frontend Monitor / Web / Custom')
@Controller('/api/v1/custom')
export class CustomController {
  constructor(private readonly webCustom: WebCustomService) {}

  @Get('/getCustomFilterList')
  @ApiOperation({summary: 'Get custom filter list'})
  @ApiResponse({type: WebMonitorCustomFilterListResponseDto})
  async getCustomFilterList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('获取自定义filter：appId不能为空');
    const result = await this.webCustom.getCustomFilterList(appId);
    return func.result({data: result});
  }

  @Post('/addCustomFilter')
  @ApiOperation({summary: 'Add a custom filter'})
  @ApiResponse({type: Boolean})
  async addCustomFilter(@Body() body: any) {
    const {appId, filterKey, filterDesc} = body;
    const ok = await this.webCustom.addCustomFilter(appId, filterKey, filterDesc);
    return func.result({data: ok});
  }

  @Post('/delCustomFilter')
  @ApiOperation({summary: 'Delete a custom filter'})
  @ApiResponse({type: Boolean})
  async delCustomFilter(@Body() body: any) {
    const {appId, _id} = body;
    const ok = await this.webCustom.delCustomFilter(appId, _id);
    return func.result({data: ok});
  }

  @Get('/getAverageCustomList')
  @ApiOperation({summary: 'Get average custom category list'})
  @ApiResponse({type: WebMonitorCustomAverageListResponseDto})
  async getAverageCustomList(@Query() q: any) {
    const {appId, pageNo = 1, pageSize = 15, beginTime, endTime, customName, customFilter} = q;
    if (!appId) throw new Error('获取custom分类列表：appId不能为空');
    const result = await this.webCustom.getAverageCustomList(
      appId,
      Number(pageNo),
      Number(pageSize),
      beginTime,
      endTime,
      customName,
      customFilter
    );
    return func.result({data: result});
  }
}
