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
    if (!appId) throw new Error('Get error category list: appId must not be empty');
    const result = await this.errorSrv.getAverageErrorList(q);
    return func.result({data: result});
  }

  @Get('/getOneErrorList')
  @ApiOperation({summary: 'Get single error resource list'})
  @ApiResponse({type: WebMonitorErrorOneListResponseDto})
  async getOneErrorList(@Query() q: any) {
    const {appId, url} = q;
    if (!appId) throw new Error('Get single ERROR resource list: appId must not be empty');
    if (!url) throw new Error('Get single ERROR resource list: url must not be empty');
    const result = await this.errorSrv.getOneErrorList(q);
    return func.result({data: result});
  }

  @Get('/getMarkUserErrorList')
  @ApiOperation({summary: 'Get marked user error list'})
  @ApiResponse({type: WebMonitorErrorMarkUserListResponseDto})
  async getMarkUserErrorList(@Query() q: any) {
    const {appId, markUser, beginTime, endTime} = q;
    if (!markUser) throw new Error('markUser must not be empty');
    if (!appId) throw new Error('Get single ajax details: appId must not be empty');
    const result = await this.errorSrv.getMarkUserErrorListCH(appId, {markUser, beginTime, endTime});
    return func.result({data: result});
  }
}
