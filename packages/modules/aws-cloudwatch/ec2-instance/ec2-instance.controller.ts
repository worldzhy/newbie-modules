import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { Ec2InstanceService } from "./ec2-instance.service";
import {
  Ec2InstanceResponseDto,
  FetchEC2InstancesDto,
  ListEC2InstancesRequestDto,
  SyncEC2InstancesWatchDto,
} from "./ec2-instance.dto";

@ApiTags("AWS CloudWatch / EC2 Instance")
@ApiBearerAuth()
@Controller("ec2-instances")
export class Ec2InstanceController {
  constructor(private readonly ec2InstanceService: Ec2InstanceService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Ec2Instance)
  @ApiOperation({ summary: "List EC2 instances with optional filters" })
  @ApiResponse({ type: Ec2InstanceResponseDto, isArray: true })
  async listEC2Instances(@Query() query: ListEC2InstancesRequestDto) {
    const { projectId, status, isWatching } = query;
    return await this.ec2InstanceService.listEC2Instances({ projectId, status, isWatching });
  }

  @Get("fetch")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Ec2Instance)
  @ApiOperation({ summary: "Fetch EC2 instances from AWS and sync to DB" })
  @ApiResponse({ type: Boolean })
  async fetchEC2Instances(@Query() query: FetchEC2InstancesDto) {
    return await this.ec2InstanceService.fetchEC2Instances(query.projectId);
  }

  @Patch("syncWatch")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Ec2Instance)
  @ApiOperation({ summary: "Sync watch/unwatch status for multiple EC2 instances" })
  @ApiResponse({ type: Boolean })
  async syncEC2InstancesWatch(@Body() body: SyncEC2InstancesWatchDto) {
    return await this.ec2InstanceService.syncEC2InstancesWatch(body);
  }

  @Patch("watch/:ec2InstanceId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Ec2Instance)
  @ApiOperation({ summary: "Watch an EC2 instance" })
  @ApiResponse({ type: Ec2InstanceResponseDto })
  async watchEC2Instance(@Param("ec2InstanceId") ec2InstanceId: string) {
    return await this.ec2InstanceService.watchEC2Instance(ec2InstanceId);
  }
}
