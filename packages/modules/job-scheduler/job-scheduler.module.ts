import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { JobHandlerRegistryService } from "./scheduler/handler-registry.service";
import { JobSchedulerService } from "./scheduler/job-scheduler.service";
import { JobSchedulerController } from "./job-scheduler.controller";

@Global()
@Module({
  // This module is the unique owner of ScheduleModule.forRoot(): importing
  // forRoot more than once in one application registers every @Cron handler
  // twice. The re-export below makes SchedulerRegistry globally injectable.
  imports: [ScheduleModule.forRoot()],
  controllers: [JobSchedulerController],
  providers: [JobHandlerRegistryService, JobSchedulerService],
  exports: [ScheduleModule, JobHandlerRegistryService, JobSchedulerService],
})
export class JobSchedulerModule {}
