import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {PageService} from './services/page.service';
import {
  FrontendMonitorPageAverageListResponseDto,
  FrontendMonitorPageDetailResponseDto,
  FrontendMonitorPageVisitListResponseDto,
  FrontendMonitorRealTimePageItemResponseDto,
} from './page.dto';

@ApiTags('Frontend Monitor / Web / Pages')
@Controller('/api/v1/pages')
export class PageController {
  constructor(private readonly pageSrv: PageService) {}

  @Get('/getAveragePageList')
  @ApiOperation({summary: 'Get average page performance list'})
  @ApiResponse({type: FrontendMonitorPageAverageListResponseDto})
  async getAveragePageList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('平均页面性能列表：appId不能为空');
    const result = await this.pageSrv.getAveragePageList(q);
    return func.result({data: result});
  }

  @Get('/getRealTimeAveragePageList')
  @ApiOperation({summary: 'Get real-time average page performance list'})
  @ApiResponse({type: FrontendMonitorRealTimePageItemResponseDto, isArray: true})
  async getRealTimeAveragePageList(@Query() q: any) {
    const {appId} = q;
    if (!appId) throw new Error('实时平均页面性能列表：appId不能为空');
    if (!q.beginTime || !q.endTime) throw new Error('实时平均页面性能列表：beginTime或者endTime不能为空');
    if (new Date(q.endTime).getTime() - new Date(q.beginTime).getTime() > 60000 * 60) {
      throw new Error('实时平均页面性能列表：beginTime和endTime间隔不能大于一个小时');
    }
    const data = await this.pageSrv.getRealTimeAveragePageList(q);
    return func.result({data});
  }

  @Get('/getOnePageList')
  @ApiOperation({summary: 'Get single page performance or visit list'})
  @ApiResponse({type: FrontendMonitorPageVisitListResponseDto})
  async getOnePageList(@Query() q: any) {
    const {appId, url} = q;
    if (!appId) throw new Error('单个页面性能或访问列表：appId不能为空');
    if (!url) throw new Error('单个页面性能或访问列表：url不能为空');
    const result = await this.pageSrv.getOnePageList(q);
    return func.result({data: result});
  }

  @Get('/getPageDetails')
  @ApiOperation({summary: 'Get single page details'})
  @ApiResponse({type: FrontendMonitorPageDetailResponseDto})
  async getPageDetails(@Query() q: any) {
    const {appId, id} = q;
    if (!id) throw new Error('单个页面详情：id不能为空');
    if (!appId) throw new Error('单个页面详情：appId不能为空');
    const row = await this.pageSrv.getPageDetails(appId, id);
    return func.result({data: row || {}});
  }
}
