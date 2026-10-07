import { Module } from "@nestjs/common";
import { TaskService } from "./task.service";
import { TaskGroupService } from "./task-group.service";
import { TaskProjectService } from "./task-project.service";
import { TaskUserService } from "./task-user.service";
import { RequirementService } from "./requirement.service";
import { TaskController } from "./task.controller";
import { PrismaModule } from "@devbie/newbie/prisma/prisma.module";
import { LarkBotModule } from "../lark-bot/lark-bot.module";

@Module({
  imports: [PrismaModule, LarkBotModule],
  controllers: [TaskController],
  providers: [TaskService, TaskGroupService, TaskProjectService, TaskUserService, RequirementService],
  exports: [TaskService, TaskGroupService, TaskProjectService, TaskUserService, RequirementService],
})
export class TaskManagementModule {}
