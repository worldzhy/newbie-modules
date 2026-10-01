import { Global, Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HandlerRegistryService } from "./scheduler/handler-registry.service";
import { TaskSchedulerService } from "./scheduler/task-scheduler.service";
import { TaskSchedulingController } from "./task-scheduling.controller";

@Global()
@Module({
  // This module is the unique owner of ScheduleModule.forRoot(): importing
  // forRoot more than once in one application registers every @Cron handler
  // twice. The re-export below makes SchedulerRegistry globally injectable.
  imports: [ScheduleModule.forRoot()],
  controllers: [TaskSchedulingController],
  providers: [HandlerRegistryService, TaskSchedulerService],
  exports: [ScheduleModule, HandlerRegistryService, TaskSchedulerService],
})
export class TaskSchedulingModule {}
