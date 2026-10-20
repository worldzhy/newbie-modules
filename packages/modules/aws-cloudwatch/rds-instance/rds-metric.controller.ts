import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { GetWatchedRDSInstancesMetricRequestDto } from "./rds-instance.dto";
import { RdsMetricService } from "./rds-metric.service";

@ApiTags("AWS CloudWatch / RDS Metric")
@ApiBearerAuth()
@Controller("rds-metric")
export class RdsMetricController {
  constructor(private readonly rdsMetricService: RdsMetricService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.RdsInstance, { scope: "project" })
  @ApiOperation({ summary: "Get CloudWatch metrics for watched RDS instances" })
  @ApiResponse({ type: Object, isArray: true })
  async getWatchedRDSInstancesMetric(@Query() query: GetWatchedRDSInstancesMetricRequestDto) {
    return await this.rdsMetricService.getWatchedInstancesMetric(query);
  }
}
