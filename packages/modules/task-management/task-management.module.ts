import { Module } from "@nestjs/common";
import { TaskService } from "./task.service";
import { TaskGroupService } from "./task-group.service";
import { TaskProjectService } from "./task-project.service";
import { TaskUserService } from "./task-user.service";
import { TaskController } from "./task.controller";
import { TaskGroupController } from "./task-group.controller";
import { TaskProjectController } from "./task-project.controller";
import { TaskUserController } from "./task-user.controller";
import { PrismaModule } from "@devbie/newbie/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [TaskController, TaskGroupController, TaskProjectController, TaskUserController],
  providers: [TaskService, TaskGroupService, TaskProjectService, TaskUserService],
  exports: [TaskService, TaskGroupService, TaskProjectService, TaskUserService],
})
export class TaskManagementModule {}
