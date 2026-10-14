import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RdsInstanceService } from "./rds-instance.service";
import {
  FetchRDSInstancesDto,
  ListRDSInstancesRequestDto,
  RdsInstanceResponseDto,
  SyncRDSInstancesWatchDto,
} from "./rds-instance.dto";

@ApiTags("AWS CloudWatch / RDS Instance")
@ApiBearerAuth()
@Controller("rds-instances")
export class RdsInstanceController {
  constructor(private readonly rdsInstanceService: RdsInstanceService) {}

  @Get()
  @ApiOperation({ summary: "List RDS instances with optional filters" })
  @ApiResponse({ type: RdsInstanceResponseDto, isArray: true })
  async listRDSInstances(@Query() query: ListRDSInstancesRequestDto) {
    const { projectId, status, isWatching } = query;
    return await this.rdsInstanceService.listRDSInstances({ projectId, status, isWatching });
  }

  @Get("fetch")
  @ApiOperation({ summary: "Fetch RDS instances from AWS and sync to DB" })
  @ApiResponse({ type: Boolean })
  async fetchRDSInstances(@Query() query: FetchRDSInstancesDto) {
    return await this.rdsInstanceService.fetchRDSInstances(query.projectId);
  }

  @Patch("syncWatch")
  @ApiOperation({ summary: "Sync watch/unwatch status for multiple RDS instances" })
  @ApiResponse({ type: Boolean })
  async syncRDSInstancesWatch(@Body() body: SyncRDSInstancesWatchDto) {
    return await this.rdsInstanceService.syncRDSInstancesWatch(body);
  }

  @Patch("watch/:rdsInstanceId")
  @ApiOperation({ summary: "Watch an RDS instance" })
  @ApiResponse({ type: RdsInstanceResponseDto })
  async watchRDSInstance(@Param("rdsInstanceId") rdsInstanceId: string) {
    return await this.rdsInstanceService.watchRDSInstance(rdsInstanceId);
  }
}
