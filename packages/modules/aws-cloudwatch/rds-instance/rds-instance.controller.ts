import {Body, Controller, Get, Param, Patch, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {RdsInstanceService} from './rds-instance.service';
import {
  FetchRDSInstancesDto,
  ListRDSInstancesDto,
  RdsInstanceResponseDto,
  SyncRDSInstancesWatchDto,
} from './rds-instance.dto';

@ApiTags('AWS CloudWatch / RDS Instance')
@ApiBearerAuth()
@Controller('rds-instances')
export class RdsInstanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rdsInstanceService: RdsInstanceService
  ) {}

  @Get()
  @ApiOperation({summary: 'List RDS instances with optional filters'})
  @ApiResponse({type: RdsInstanceResponseDto, isArray: true})
  async listRDSInstances(@Query() query: ListRDSInstancesDto) {
    const {awsAccountId, status, isWatching} = query;
    return await this.prisma.rdsInstance.findMany({
      where: {awsAccountId, status, isWatching},
      orderBy: {name: 'asc'},
    });
  }

  @Get('fetch')
  @ApiOperation({summary: 'Fetch RDS instances from AWS and sync to DB'})
  @ApiResponse({type: Boolean})
  async fetchRDSInstances(@Query() query: FetchRDSInstancesDto) {
    return await this.rdsInstanceService.fetchRDSInstances(query.awsAccountId);
  }

  @Patch('syncWatch')
  @ApiOperation({summary: 'Sync watch/unwatch status for multiple RDS instances'})
  @ApiResponse({type: Boolean})
  async syncRDSInstancesWatch(@Body() body: SyncRDSInstancesWatchDto) {
    return await this.rdsInstanceService.syncRDSInstancesWatch(body);
  }

  @Patch('watch/:rdsInstanceId')
  @ApiOperation({summary: 'Watch an RDS instance'})
  @ApiResponse({type: RdsInstanceResponseDto})
  async watchRDSInstance(@Param('rdsInstanceId') rdsInstanceId: string) {
    return await this.rdsInstanceService.watchRDSInstance(rdsInstanceId);
  }
}
