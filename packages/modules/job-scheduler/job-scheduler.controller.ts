import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JobSchedulerService } from "./scheduler/job-scheduler.service";
import { JobRunDto, JobScheduleDto, ListJobRunsDto, UpdateJobScheduleDto } from "./job-scheduler.dto";

@ApiTags("Job Scheduler")
@ApiBearerAuth()
@Controller("job-scheduler")
export class JobSchedulerController {
  constructor(private readonly jobScheduler: JobSchedulerService) {}

  @Get("schedules")
  @ApiOperation({ summary: "List all job schedules" })
  @ApiResponse({ status: 200, type: [JobScheduleDto] })
  listSchedules(): Promise<JobScheduleDto[]> {
    return this.jobScheduler.listSchedules() as Promise<JobScheduleDto[]>;
  }

  @Get("schedules/:key/runs")
  @ApiOperation({ summary: "List recent execution runs for a job schedule" })
  @ApiResponse({ status: 200, type: [JobRunDto] })
  listScheduleRuns(@Param("key") key: string, @Query() query: ListJobRunsDto): Promise<JobRunDto[]> {
    return this.jobScheduler.listScheduleRuns(key, query.limit) as Promise<JobRunDto[]>;
  }

  @Patch("schedules/:key")
  @ApiOperation({ summary: "Update runtime-editable fields (enabled, cronExpr, timezone) of a job schedule" })
  @ApiResponse({ status: 200, type: JobScheduleDto })
  updateSchedule(@Param("key") key: string, @Body() body: UpdateJobScheduleDto): Promise<JobScheduleDto> {
    return this.jobScheduler.updateSchedule(key, body ?? {}) as Promise<JobScheduleDto>;
  }

  @Post("schedules/:key/trigger")
  @ApiOperation({ summary: "Manually trigger a job schedule now" })
  @ApiResponse({ status: 200, type: JobRunDto })
  triggerSchedule(@Param("key") key: string): Promise<JobRunDto> {
    return this.jobScheduler.triggerSchedule(key) as Promise<JobRunDto>;
  }
}
