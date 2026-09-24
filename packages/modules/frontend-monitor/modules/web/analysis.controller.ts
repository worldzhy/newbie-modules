import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {AnalysisService} from './services/analysis.service';
import {
  FrontendMonitorAnalysisUserListResponseDto,
  FrontendMonitorProvinceCountResponseDto,
  FrontendMonitorWebTopDatasResponseDto,
} from './analysis.dto';
import {FrontendMonitorEnvironmentResponseDto} from './environment.dto';

@ApiTags('Frontend Monitor / Web / Analysis')
@Controller('/api/v1/analysis')
export class AnalysisController {
  constructor(private readonly analysisSrv: AnalysisService) {}

  @Get('/getAnalysislist')
  @ApiOperation({summary: 'Get user funnel analysis list'})
  @ApiResponse({type: FrontendMonitorAnalysisUserListResponseDto})
  async getAnalysislist(@Query() q: any) {
    const {appId, beginTime, endTime, uid, phone} = q;
    if (!appId) throw new Error('用户漏斗分析列表：appId不能为空');
    const result = await this.analysisSrv.getAnalysislist(appId, beginTime, endTime, {uid, phone});
    return func.result({data: result});
  }

  @Get('/getAnalysisOneList')
  @ApiOperation({summary: 'Get single user behavior track list'})
  @ApiResponse({type: FrontendMonitorEnvironmentResponseDto, isArray: true})
  async getAnalysisOneList(@Query() q: any) {
    const {appId, markUser} = q;
    if (!appId) throw new Error('单个用户行为轨迹列表：appId不能为空');
    if (!markUser) throw new Error('单个用户行为轨迹列表：markUser不能为空');
    const result = await this.analysisSrv.getAnalysisOneList(appId, markUser);
    return func.result({data: result});
  }

  @Get('/getTopDatas')
  @ApiOperation({summary: 'Get top data statistics'})
  @ApiResponse({type: FrontendMonitorWebTopDatasResponseDto})
  async getTopDatas(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('appId不能为空');
    const data = await this.analysisSrv.getTopDatas(appId, beginTime, endTime);
    return func.result({data});
  }

  @Get('/getProvinceCount')
  @ApiOperation({summary: 'Get province count statistics'})
  @ApiResponse({type: FrontendMonitorProvinceCountResponseDto})
  async getProvinceCount(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('appId不能为空');
    const result = await this.analysisSrv.getProvinceCount(appId, beginTime, endTime);
    return func.result({data: result});
  }
}
