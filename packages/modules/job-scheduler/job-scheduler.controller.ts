import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { JobSchedulerService } from "./scheduler/job-scheduler.service";
import {
  JobRunDto,
  JobScheduleDto,
  ListJobRunsRequestDto,
  ListJobRunsResponseDto,
  UpdateJobScheduleDto,
} from "./job-scheduler.dto";

@ApiTags("Job Scheduler")
@ApiBearerAuth()
@Controller("job-scheduler")
export class JobSchedulerController {
  constructor(private readonly jobScheduler: JobSchedulerService) {}

  @Get("schedules")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.JobSchedule)
  @ApiOperation({ summary: "List all job schedules" })
  @ApiResponse({ status: 200, type: [JobScheduleDto] })
  listSchedules(): Promise<JobScheduleDto[]> {
    return this.jobScheduler.listSchedules() as Promise<JobScheduleDto[]>;
  }

  @Get("schedules/:key/runs")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.JobRun)
  @ApiOperation({ summary: "List execution runs for a job schedule" })
  @ApiResponse({ status: 200, type: ListJobRunsResponseDto })
  listScheduleRuns(@Param("key") key: string, @Query() query: ListJobRunsRequestDto): Promise<ListJobRunsResponseDto> {
    return this.jobScheduler.listScheduleRuns(key, query.page, query.pageSize) as Promise<ListJobRunsResponseDto>;
  }

  @Patch("schedules/:key")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.JobSchedule)
  @ApiOperation({ summary: "Update runtime-editable fields (isEnabled, cronExpr, timezone) of a job schedule" })
  @ApiResponse({ status: 200, type: JobScheduleDto })
  updateSchedule(@Param("key") key: string, @Body() body: UpdateJobScheduleDto): Promise<JobScheduleDto> {
    return this.jobScheduler.updateSchedule(key, body ?? {}) as Promise<JobScheduleDto>;
  }

  @Post("schedules/:key/trigger")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.JobSchedule)
  @ApiOperation({ summary: "Manually trigger a job schedule now" })
  @ApiResponse({ status: 200, type: JobRunDto })
  triggerSchedule(@Param("key") key: string): Promise<JobRunDto> {
    return this.jobScheduler.triggerSchedule(key) as Promise<JobRunDto>;
  }
}
