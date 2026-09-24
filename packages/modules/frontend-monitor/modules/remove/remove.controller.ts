import {Controller, Post, Body} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {RemoveService} from './remove.service';
import {func} from '../../shared/utils';

@ApiTags('Frontend Monitor / Remove')
@Controller('/api/v1/remove')
export class RemoveController {
  constructor(private readonly removeService: RemoveService) {}

  @Post('/customDeleteData')
  @ApiOperation({summary: 'Custom delete monitoring data'})
  @ApiResponse({type: Object})
  async customDelete(@Body() body: any) {
    const result = await this.removeService.customDelete(body);
    return func.result({
      data: result,
    });
  }
}
