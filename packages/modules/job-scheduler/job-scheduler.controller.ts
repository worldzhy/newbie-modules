import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JobSchedulerService } from "./scheduler/job-scheduler.service";
import {
  ListScheduledJobRunsDto,
  ScheduledJobDto,
  ScheduledJobRunDto,
  UpdateScheduledJobDto,
} from "./job-scheduler.dto";

@ApiTags("Job Scheduler")
@ApiBearerAuth()
@Controller("job-scheduler")
export class JobSchedulerController {
  constructor(private readonly jobScheduler: JobSchedulerService) {}

  @Get("jobs")
  @ApiOperation({ summary: "List all scheduled job definitions" })
  @ApiResponse({ status: 200, type: [ScheduledJobDto] })
  listJobs(): Promise<ScheduledJobDto[]> {
    return this.jobScheduler.listJobs() as Promise<ScheduledJobDto[]>;
  }

  @Get("jobs/:key/runs")
  @ApiOperation({ summary: "List recent execution history for a scheduled job" })
  @ApiResponse({ status: 200, type: [ScheduledJobRunDto] })
  listJobRuns(@Param("key") key: string, @Query() query: ListScheduledJobRunsDto): Promise<ScheduledJobRunDto[]> {
    return this.jobScheduler.listJobRuns(key, query.limit) as Promise<ScheduledJobRunDto[]>;
  }

  @Patch("jobs/:key")
  @ApiOperation({ summary: "Update runtime-editable fields (enabled, cronExpr, timezone) of a scheduled job" })
  @ApiResponse({ status: 200, type: ScheduledJobDto })
  updateJob(@Param("key") key: string, @Body() body: UpdateScheduledJobDto): Promise<ScheduledJobDto> {
    return this.jobScheduler.updateJob(key, body ?? {}) as Promise<ScheduledJobDto>;
  }

  @Post("jobs/:key/trigger")
  @ApiOperation({ summary: "Manually trigger a scheduled job now" })
  @ApiResponse({ status: 200, type: ScheduledJobRunDto })
  triggerJob(@Param("key") key: string): Promise<ScheduledJobRunDto> {
    return this.jobScheduler.triggerJob(key) as Promise<ScheduledJobRunDto>;
  }
}
