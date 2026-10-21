import { Controller, Get, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Scopes } from "../auth/scope.decorator";
import { ProcessMetricData } from "./metrics.interface";
import { MetricsService } from "./metrics.service";

@ApiTags("Metrics")
@Controller("metrics")
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  /** Get process metrics */
  @Get("process")
  @ApiOkResponse()
  @Scopes("metric:read-process")
  process(): Promise<ProcessMetricData[]> {
    return this.metricsService.getProcessMetrics();
  }

  /** Update metrics */
  @Post("update")
  @ApiOkResponse()
  @Scopes("metric:write-process")
  update(): Promise<ProcessMetricData[]> {
    return this.metricsService.updateProcessMetrics();
  }
}
