import { Global, Module } from "@nestjs/common";
import { TaskService } from "./task.service";
import { TaskActorService } from "./task-actor.service";
import { TaskController } from "./task.controller";
import { TaskActorController } from "./task-actor.controller";

@Global()
@Module({
  controllers: [TaskController, TaskActorController],
  providers: [TaskService, TaskActorService],
  exports: [TaskService, TaskActorService],
})
export class TaskManagementModule {}
