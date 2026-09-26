import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {ErrorService} from './services/error.service';
import {
  WebMonitorErrorListResponseDto,
  WebMonitorErrorMarkUserListResponseDto,
  WebMonitorErrorOneListResponseDto,
} from './error.dto';

@ApiTags('Frontend Monitor / Web / Error')
@Controller('/api/v1/error')
export class ErrorController {
  constructor(private readonly errorSrv: ErrorService) {}

  @Get('/getAverageErrorList')
  @ApiOperation({summary: 'Get average error category list'})
  @ApiResponse({type: WebMonitorErrorListResponseDto})
  async getAverageErrorList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('获得error分类列表：appId不能为空');
    const result = await this.errorSrv.getAverageErrorList(q);
    return func.result({data: result});
  }

  @Get('/getOneErrorList')
  @ApiOperation({summary: 'Get single error resource list'})
  @ApiResponse({type: WebMonitorErrorOneListResponseDto})
  async getOneErrorList(@Query() q: any) {
    const {appId, url} = q;
    if (!appId) throw new Error('获得单个ERROR资源列表信息：appId不能为空');
    if (!url) throw new Error('获得单个ERROR资源列表信息：url地址不能为空');
    const result = await this.errorSrv.getOneErrorList(q);
    return func.result({data: result});
  }

  @Get('/getMarkUserErrorList')
  @ApiOperation({summary: 'Get marked user error list'})
  @ApiResponse({type: WebMonitorErrorMarkUserListResponseDto})
  async getMarkUserErrorList(@Query() q: any) {
    const {appId, markUser, beginTime, endTime} = q;
    if (!markUser) throw new Error('markUser不能为空');
    if (!appId) throw new Error('获得单个ajax详情信息：appId不能为空');
    const result = await this.errorSrv.getMarkUserErrorListCH(appId, {markUser, beginTime, endTime});
    return func.result({data: result});
  }
}
