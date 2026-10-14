import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { GetWatchedRDSInstancesMetricRequestDto } from "./rds-instance.dto";
import { RdsMetricService } from "./rds-metric.service";

@ApiTags("AWS CloudWatch / RDS Metric")
@ApiBearerAuth()
@Controller("rds-metric")
export class RdsMetricController {
  constructor(private readonly rdsMetricService: RdsMetricService) {}

  @Get()
  @ApiOperation({ summary: "Get CloudWatch metrics for watched RDS instances" })
  @ApiResponse({ type: Object, isArray: true })
  async getWatchedRDSInstancesMetric(@Query() query: GetWatchedRDSInstancesMetricRequestDto) {
    return await this.rdsMetricService.getWatchedInstancesMetric(query);
  }
}
