import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {WxAnalysisService} from './services/analysis.service';
import {
  FrontendMonitorAnalysisUserListResponseDto,
  FrontendMonitorProvinceCountResponseDto,
  FrontendMonitorWxTopDatasResponseDto,
} from '../web/analysis.dto';
import {FrontendMonitorWxPageDetailResponseDto} from './page.dto';

@ApiTags('Frontend Monitor / Wx / Analysis')
@Controller('/api/v1/wx/analysis')
export class WxAnalysisController {
  constructor(private readonly wxAnalysis: WxAnalysisService) {}

  @Get('/getAnalysislist')
  @ApiOperation({summary: 'Get user funnel analysis list'})
  @ApiResponse({type: FrontendMonitorAnalysisUserListResponseDto})
  async getAnalysislist(@Query() q: any) {
    const {appId, beginTime, endTime, uid, phone} = q;
    if (!appId) throw new Error('用户漏斗分析列表：appId不能为空');
    const result = await this.wxAnalysis.getAnalysislist(appId, beginTime, endTime, {uid, phone});
    return func.result({data: result});
  }

  @Get('/getAnalysisOneList')
  @ApiOperation({summary: 'Get single user behavior track list'})
  @ApiResponse({type: FrontendMonitorWxPageDetailResponseDto, isArray: true})
  async getAnalysisOneList(@Query() q: any) {
    const {appId, markUser} = q;
    if (!appId) throw new Error('单个用户行为轨迹列表：appId不能为空');
    if (!markUser) throw new Error('单个用户行为轨迹列表：markUser不能为空');
    const result = await this.wxAnalysis.getAnalysisOneList(appId, markUser);
    const newR: any[] = [];
    result.map((item: any, i: number) => {
      if (i === 0) newR.push(item);
      else if (item.path !== newR[newR.length - 1].path) newR.push(item);
    });
    return func.result({data: newR});
  }

  @Get('/getTopDatas')
  @ApiOperation({summary: 'Get top page data statistics'})
  @ApiResponse({type: FrontendMonitorWxTopDatasResponseDto})
  async getTopDatas(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('top页面：appId不能为空');
    const result = await this.wxAnalysis.getTopDatas(appId, beginTime, endTime);
    return func.result({data: result});
  }

  @Get('/getProvinceCount')
  @ApiOperation({summary: 'Get province count statistics'})
  @ApiResponse({type: FrontendMonitorProvinceCountResponseDto})
  async getProvinceCount(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('appId不能为空');
    const result = await this.wxAnalysis.getProvinceCount(appId, beginTime, endTime);
    return func.result({data: result});
  }
}
