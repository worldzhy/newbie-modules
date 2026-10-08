import { Module } from "@nestjs/common";
import { TaskService } from "./task.service";
import { TaskSpaceService } from "./task-space.service";
import { TaskUserService } from "./task-user.service";
import { TaskController } from "./task.controller";
import { TaskSpaceController } from "./task-space.controller";
import { TaskUserController } from "./task-user.controller";
import { PrismaModule } from "@devbie/newbie/prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  controllers: [TaskController, TaskSpaceController, TaskUserController],
  providers: [TaskService, TaskSpaceService, TaskUserService],
  exports: [TaskService, TaskSpaceService, TaskUserService],
})
export class TaskManagementModule {}
