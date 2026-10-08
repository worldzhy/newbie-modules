import { Body, Controller, Delete, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { UserRequest } from "@modules/security/security.interface";
import { TaskService } from "./task.service";
import { BatchCreateTasksResponseDto, CreateTasksBatchRequestDto, TaskDto, UpdateTaskRequestDto } from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("tasks")
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Post("batch")
  @ApiOperation({ summary: "Batch create tasks in an existing task space" })
  @ApiResponse({ status: 200, type: BatchCreateTasksResponseDto })
  async createTasksBatch(@Body() dto: CreateTasksBatchRequestDto): Promise<BatchCreateTasksResponseDto> {
    const result = await this.taskService.createTasksBatch(dto);
    return { success: true, data: result };
  }

  @Patch(":taskId")
  @ApiOperation({ summary: "Update a task (validated status transitions)" })
  @ApiResponse({ status: 200, type: TaskDto })
  async updateTask(
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<TaskDto> {
    const operator = {
      id: req.user.userId,
      name: req.user.userId,
      source: "SYSTEM",
    };

    return await this.taskService.updateTask(taskId, dto, operator);
  }

  @Delete(":taskId")
  @ApiOperation({ summary: "Soft delete a task" })
  @ApiResponse({ status: 200, type: TaskDto })
  async deleteTask(@Param("taskId") taskId: string, @Req() req: UserRequest): Promise<TaskDto> {
    const operator = {
      id: req.user.userId,
      name: req.user.userId,
      source: "SYSTEM",
    };
    return await this.taskService.deleteTask(taskId, operator);
  }
}
