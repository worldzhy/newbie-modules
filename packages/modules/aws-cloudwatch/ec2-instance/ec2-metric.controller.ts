import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { Ec2MetricService } from "./ec2-metric.service";
import { GetWatchedEC2InstancesMetricRequestDto } from "./ec2-metric.dto";

@ApiTags("AWS CloudWatch / EC2 Metric")
@ApiBearerAuth()
@Controller("ec2-metric")
export class Ec2MetricController {
  constructor(private readonly ec2MetricService: Ec2MetricService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Ec2Instance)
  @ApiOperation({ summary: "Get CloudWatch metrics for watched EC2 instances" })
  @ApiResponse({ type: Object, isArray: true })
  async getWatchedEC2InstancesMetric(@Query() query: GetWatchedEC2InstancesMetricRequestDto) {
    return await this.ec2MetricService.getWatchedInstancesMetric(query);
  }
}
