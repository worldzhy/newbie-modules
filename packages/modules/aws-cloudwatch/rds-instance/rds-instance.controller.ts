import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
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
  @RequirePermission(PermissionAction.List, Prisma.ModelName.RdsInstance, { scope: "project" })
  @ApiOperation({ summary: "List RDS instances with optional filters" })
  @ApiResponse({ type: RdsInstanceResponseDto, isArray: true })
  async listRDSInstances(@Query() query: ListRDSInstancesRequestDto) {
    const { projectId, status, isWatching } = query;
    return await this.rdsInstanceService.listRDSInstances({ projectId, status, isWatching });
  }

  @Get("fetch")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.RdsInstance, { scope: "project" })
  @ApiOperation({ summary: "Fetch RDS instances from AWS and sync to DB" })
  @ApiResponse({ type: Boolean })
  async fetchRDSInstances(@Query() query: FetchRDSInstancesDto) {
    return await this.rdsInstanceService.fetchRDSInstances(query.projectId);
  }

  @Patch("syncWatch")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.RdsInstance, { scope: "project" })
  @ApiOperation({ summary: "Sync watch/unwatch status for multiple RDS instances" })
  @ApiResponse({ type: Boolean })
  async syncRDSInstancesWatch(@Body() body: SyncRDSInstancesWatchDto) {
    return await this.rdsInstanceService.syncRDSInstancesWatch(body);
  }

  @Patch("watch/:rdsInstanceId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.RdsInstance)
  @ApiOperation({ summary: "Watch an RDS instance" })
  @ApiResponse({ type: RdsInstanceResponseDto })
  async watchRDSInstance(@Param("rdsInstanceId") rdsInstanceId: string) {
    return await this.rdsInstanceService.watchRDSInstance(rdsInstanceId);
  }
}
