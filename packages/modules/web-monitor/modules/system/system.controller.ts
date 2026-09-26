import {Controller, Get, Post, Body, Query} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {SystemService} from './system.service';
import {func} from '../../shared/utils';
import {WebMonitorSystemResponseDto} from './system.dto';

@ApiTags('Frontend Monitor / System')
@Controller('/api/v1/system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Post('/add')
  @ApiOperation({summary: 'Add a new monitoring system'})
  @ApiResponse({type: Object})
  async addNewSystem(@Body() body: any) {
    const res = await this.system.saveSystemData(body);
    return res;
  }

  @Post('/update')
  @ApiOperation({summary: 'Update a monitoring system'})
  @ApiResponse({type: Object})
  async updateSystem(@Body() body: any) {
    const res = await this.system.updateSystemData(body);
    return res;
  }

  @Get('/getSysForUserId')
  @ApiOperation({summary: 'Get systems for a user'})
  @ApiResponse({type: WebMonitorSystemResponseDto, isArray: true})
  async getSysForUserId(@Query() query: any) {
    const result = await this.system.getSysForUserId(query);
    return func.result({data: result});
  }

  @Get('/getSystemForId')
  @ApiOperation({summary: 'Get system by appId'})
  @ApiResponse({type: WebMonitorSystemResponseDto})
  async getSystemForId(@Query('appId') appId: string) {
    const result = await this.system.getSystemForDb(appId);
    return func.result({data: result});
  }

  @Get('/web/list')
  @ApiOperation({summary: 'Get web system list'})
  @ApiResponse({type: WebMonitorSystemResponseDto, isArray: true})
  async getWebSystemList() {
    const result = await this.system.getWebSystemList();
    return func.result({data: result});
  }

  @Post('/deleteUser')
  @ApiOperation({summary: 'Delete a user from a system'})
  @ApiResponse({type: Object})
  async deleteWebSystemUser(@Body() body: any) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error('删除系统中某个用户：appId不能为空');
    if (!userToken) throw new Error('删除系统中某个用户：用户Token不能为空');
    const result = await this.system.deleteWebSystemUser(appId, userToken);
    return func.result({data: result});
  }

  @Post('/addUser')
  @ApiOperation({summary: 'Add a user to a system'})
  @ApiResponse({type: Object})
  async addWebSystemUser(@Body() body: any) {
    const appId = body.appId;
    const userToken = body.userToken;
    if (!appId) throw new Error('系统中新增某个用户：appId不能为空');
    if (!userToken) throw new Error('系统中新增某个用户：用户Token不能为空');
    const result = await this.system.addWebSystemUser(appId, userToken);
    return func.result({data: result});
  }

  @Post('/deleteSystem')
  @ApiOperation({summary: 'Delete a system'})
  @ApiResponse({type: Object})
  async deleteSystem(@Body() body: any): Promise<any> {
    const appId = body.appId;
    const type = body.type;
    if (!appId) throw new Error('删除某个系统：appId不能为空');
    const result = await this.system.deleteSystem(appId, type);
    return func.result({data: result});
  }

  @Post('/handleDaliyEmail')
  @ApiOperation({summary: 'Handle daily email report'})
  @ApiResponse({type: Object})
  async handleDaliyEmail(@Body() body: any) {
    const appId = body.appId;
    const email = body.email;
    const type = body.type || 1;
    const item = body.item || 1;
    if (!appId) throw new Error('appId不能为空');
    const result = await this.system.handleDaliyEmail(appId, email, type, true, item);
    return func.result({data: result});
  }
}
