import { Global, Module } from "@nestjs/common";
import { TaskService } from "./task.service";
import { TaskSpaceService } from "./task-space.service";
import { TaskParticipantService } from "./task-participant.service";
import { TaskController } from "./task.controller";
import { TaskSpaceController } from "./task-space.controller";
import { TaskParticipantController } from "./task-participant.controller";
import { PrismaModule } from "@devbie/newbie/prisma/prisma.module";

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [TaskController, TaskSpaceController, TaskParticipantController],
  providers: [TaskService, TaskSpaceService, TaskParticipantService],
  exports: [TaskService, TaskSpaceService, TaskParticipantService],
})
export class TaskManagementModule {}
