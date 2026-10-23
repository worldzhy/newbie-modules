import { Body, Controller, Delete, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { TaskService } from "./task.service";
import { TaskParticipantService } from "./task-participant.service";
import { BatchCreateTasksResponseDto, CreateTasksBatchRequestDto, TaskDto, UpdateTaskRequestDto } from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("tasks")
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskParticipantService: TaskParticipantService,
  ) {}

  @Post("batch")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Batch create tasks in an existing task space" })
  @ApiResponse({ status: 200, type: BatchCreateTasksResponseDto })
  async createTasksBatch(@Body() dto: CreateTasksBatchRequestDto): Promise<BatchCreateTasksResponseDto> {
    const result = await this.taskService.createTasksBatch(dto);
    return { success: true, data: result };
  }

  @Patch(":taskId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Update a task (validated status transitions)" })
  @ApiResponse({ status: 200, type: TaskDto })
  async updateTask(
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<TaskDto> {
    const participant = await this.taskParticipantService.ensureHostParticipant({ userId: req.user.userId });
    return await this.taskService.updateTask(taskId, dto, {
      participantId: participant.id,
      name: participant.name ?? undefined,
    });
  }

  @Delete(":taskId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Soft delete a task" })
  @ApiResponse({ status: 200, type: TaskDto })
  async deleteTask(@Param("taskId") taskId: string, @Req() req: UserRequest): Promise<TaskDto> {
    const participant = await this.taskParticipantService.ensureHostParticipant({ userId: req.user.userId });
    return await this.taskService.deleteTask(taskId, {
      participantId: participant.id,
      name: participant.name ?? undefined,
    });
  }
}
