import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {AnalysisService} from './services/analysis.service';
import {
  WebMonitorAnalysisUserListResponseDto,
  WebMonitorProvinceCountResponseDto,
  WebMonitorWebTopDatasResponseDto,
} from './analysis.dto';
import {WebMonitorEnvironmentResponseDto} from './environment.dto';

@ApiTags('Frontend Monitor / Web / Analysis')
@Controller('/api/v1/analysis')
export class AnalysisController {
  constructor(private readonly analysisSrv: AnalysisService) {}

  @Get('/getAnalysislist')
  @ApiOperation({summary: 'Get user funnel analysis list'})
  @ApiResponse({type: WebMonitorAnalysisUserListResponseDto})
  async getAnalysislist(@Query() q: any) {
    const {appId, beginTime, endTime, uid, phone} = q;
    if (!appId) throw new Error('User funnel analysis list: appId must not be empty');
    const result = await this.analysisSrv.getAnalysislist(appId, beginTime, endTime, {uid, phone});
    return func.result({data: result});
  }

  @Get('/getAnalysisOneList')
  @ApiOperation({summary: 'Get single user behavior track list'})
  @ApiResponse({type: WebMonitorEnvironmentResponseDto, isArray: true})
  async getAnalysisOneList(@Query() q: any) {
    const {appId, markUser} = q;
    if (!appId) throw new Error('Single user behavior trail list: appId must not be empty');
    if (!markUser) throw new Error('Single user behavior trail list: markUser must not be empty');
    const result = await this.analysisSrv.getAnalysisOneList(appId, markUser);
    return func.result({data: result});
  }

  @Get('/getTopDatas')
  @ApiOperation({summary: 'Get top data statistics'})
  @ApiResponse({type: WebMonitorWebTopDatasResponseDto})
  async getTopDatas(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('appId must not be empty');
    const data = await this.analysisSrv.getTopDatas(appId, beginTime, endTime);
    return func.result({data});
  }

  @Get('/getProvinceCount')
  @ApiOperation({summary: 'Get province count statistics'})
  @ApiResponse({type: WebMonitorProvinceCountResponseDto})
  async getProvinceCount(@Query() q: any) {
    const {appId, beginTime, endTime} = q;
    if (!appId) throw new Error('appId must not be empty');
    const result = await this.analysisSrv.getProvinceCount(appId, beginTime, endTime);
    return func.result({data: result});
  }
}
