import {Controller, Get, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {func} from '../../shared/utils';
import {WxEventService} from './services/event.service';
import {FrontendMonitorWxEventListResponseDto} from './event.dto';

@ApiTags('Frontend Monitor / Wx / Event')
@Controller('/api/v1/wx/event')
export class WxEventController {
  constructor(private readonly wxEvent: WxEventService) {}

  @Get('/getEventList')
  @ApiOperation({summary: 'Get wx event list'})
  @ApiResponse({type: FrontendMonitorWxEventListResponseDto})
  async getEventList(@Query() q: any) {
    const {appId, beginTime, endTime, event, pageNo = 1, pageSize = 15} = q;
    if (!appId) throw new Error('appId不能为空');
    const result = await this.wxEvent.getEventList({
      appId,
      beginTime,
      endTime,
      pageNo: Number(pageNo),
      pageSize: Number(pageSize),
      event,
    });
    return func.result({data: result});
  }
}
