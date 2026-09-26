import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {AjaxService} from './services/ajax.service';
import {
  WebMonitorAjaxAverageListResponseDto,
  WebMonitorAjaxMarkUserListResponseDto,
  WebMonitorAjaxOneListResponseDto,
} from './ajax.dto';

@ApiTags('Frontend Monitor / Web / Ajax')
@Controller('/api/v1/ajax')
export class AjaxController {
  constructor(private readonly ajax: AjaxService) {}

  @Get('/getPageAjaxsAvg')
  @ApiOperation({summary: 'Get page ajax average performance'})
  @ApiResponse({type: WebMonitorAjaxAverageListResponseDto})
  async getPageAjaxsAvg(@Query() q: any) {
    const {appId, url, beginTime, endTime} = q;
    if (!appId) throw new Error('页面ajax信息：appId不能为空');
    if (!url) throw new Error('页面ajax信息：url不能为空');
    const result = await this.ajax.getPageAjaxsAvg(appId, url, beginTime, endTime);
    return func.result({data: result});
  }

  @Get('/getAverageAjaxList')
  @ApiOperation({summary: 'Get average ajax performance list'})
  @ApiResponse({type: WebMonitorAjaxAverageListResponseDto})
  async getAverageAjaxList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('平均AJAX性能列表：appId不能为空');
    const result = await this.ajax.getAverageAjaxList(q);
    return func.result({data: result});
  }

  @Get('/getOneAjaxList')
  @ApiOperation({summary: 'Get single ajax average performance data'})
  @ApiResponse({type: WebMonitorAjaxOneListResponseDto})
  async getOneAjaxList(@Query() q: any) {
    const {appId, url, pageNo = 1, pageSize = 15, beginTime, endTime, type} = q;
    if (!appId) throw new Error('单个AJAX平均性能数据：appId不能为空');
    if (!url) throw new Error('单个AJAX平均性能数据：api地址不能为空');
    const result = await this.ajax.getOneAjaxList(appId, url, pageNo, pageSize, beginTime, endTime, type);
    return func.result({data: result});
  }

  @Get('/getMarkUserAjaxList')
  @ApiOperation({summary: 'Get marked user ajax list'})
  @ApiResponse({type: WebMonitorAjaxMarkUserListResponseDto})
  async getMarkUserAjaxList(@Query() q: any) {
    const {appId, markUser, beginTime, endTime} = q;
    if (!markUser) throw new Error('markUser不能为空');
    if (!appId) throw new Error('获得单个ajax详情信息：appId不能为空');
    const result = await this.ajax.getMarkUserAjaxList(appId, {markUser, beginTime, endTime});
    return func.result({data: result});
  }
}
