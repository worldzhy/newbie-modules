import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {EnvironmentService} from './services/environment.service';
import {
  FrontendMonitorEnvironmentGroupByItemResponseDto,
  FrontendMonitorEnvironmentResponseDto,
} from './environment.dto';

@ApiTags('Frontend Monitor / Web / Environment')
@Controller('/api/v1/environment')
export class EnvironmentController {
  constructor(private readonly envSrv: EnvironmentService) {}

  @Get('/getDataGroupBy')
  @ApiOperation({summary: 'Get environment data grouped by type'})
  @ApiResponse({type: FrontendMonitorEnvironmentGroupByItemResponseDto, isArray: true})
  async getDataGroupBy(@Query() q: any) {
    const {appId, url, beginTime, endTime, type = 1} = q;
    if (!appId) throw new Error('页面性能列表：appId不能为空');
    if (!url) throw new Error('页面性能列表：url不能为空');
    const result = await this.envSrv.getDataGroupBy(Number(type), url, appId, beginTime, endTime);
    return func.result({data: result});
  }

  @Get('/getEnvironmentForPage')
  @ApiOperation({summary: 'Get environment info for a page'})
  @ApiResponse({type: FrontendMonitorEnvironmentResponseDto})
  async getEnvironmentForPage(@Query() q: any) {
    const {appId, markPage} = q;
    if (!appId) throw new Error('根据markPage获得用户系统信息：appId不能为空');
    if (!markPage) throw new Error('根据markPage获得用户系统信息：markPage不能为空');
    const result = await this.envSrv.getEnvironmentForPage(appId, markPage);
    return func.result({data: result});
  }
}
