import {Body, Controller, Get, Param, Patch, Query} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Ec2InstanceService} from './ec2-instance.service';
import {
  Ec2InstanceResponseDto,
  FetchEC2InstancesDto,
  ListEC2InstancesDto,
  SyncEC2InstancesWatchDto,
} from './ec2-instance.dto';

@ApiTags('AWS CloudWatch / EC2 Instance')
@ApiBearerAuth()
@Controller('ec2-instances')
export class Ec2InstanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ec2InstanceService: Ec2InstanceService
  ) {}

  @Get()
  @ApiOperation({summary: 'List EC2 instances with optional filters'})
  @ApiResponse({type: Ec2InstanceResponseDto, isArray: true})
  async listEC2Instances(@Query() query: ListEC2InstancesDto) {
    const {awsAccountId, status, isWatching} = query;
    return await this.prisma.ec2Instance.findMany({
      where: {awsAccountId, status, isWatching},
      orderBy: {name: 'asc'},
    });
  }

  @Get('fetch')
  @ApiOperation({summary: 'Fetch EC2 instances from AWS and sync to DB'})
  @ApiResponse({type: Boolean})
  async fetchEC2Instances(@Query() query: FetchEC2InstancesDto) {
    return await this.ec2InstanceService.fetchEC2Instances(query.awsAccountId);
  }

  @Patch('syncWatch')
  @ApiOperation({summary: 'Sync watch/unwatch status for multiple EC2 instances'})
  @ApiResponse({type: Boolean})
  async syncEC2InstancesWatch(@Body() body: SyncEC2InstancesWatchDto) {
    return await this.ec2InstanceService.syncEC2InstancesWatch(body);
  }

  @Patch('watch/:id')
  @ApiOperation({summary: 'Watch an EC2 instance'})
  @ApiResponse({type: Ec2InstanceResponseDto})
  async watchEC2Instance(@Param('id') id: string) {
    return await this.ec2InstanceService.watchEC2Instance(id);
  }
}
