import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { TaskService } from "./task.service";
import { TaskActorService } from "./task-actor.service";
import {
  BatchCreateTasksResultDto,
  CreateTaskRequestDto,
  CreateTasksBatchRequestDto,
  ListTasksRequestDto,
  ListTasksResponseDto,
  TaskWithRelationsDto,
  UpdateTaskRequestDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("tasks")
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskActorService: TaskActorService,
  ) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Task)
  @ApiOperation({ summary: "List the tasks of a project" })
  @ApiResponse({ status: 200, type: ListTasksResponseDto })
  async listTasksByProjectId(
    @Query("projectId") projectId: string,
    @Query() query: ListTasksRequestDto,
  ): Promise<ListTasksResponseDto> {
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 20;

    const result = await this.taskService.listTasks({
      projectId,
      status: query.status,
      keyword: query.keyword,
      assigneeName: query.assigneeName,
      includeCompleted: true,
      skip: page * pageSize,
      take: pageSize,
    });

    return {
      records: result.tasks,
      pagination: {
        countOfCurrentPage: result.tasks.length,
        countOfTotal: result.total,
        page,
        pageSize,
      },
    };
  }

  @Get(":taskId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Get one task with its actors and prerequisites" })
  @ApiResponse({ status: 200, type: TaskWithRelationsDto })
  async getTask(@Param("taskId") taskId: string): Promise<TaskWithRelationsDto> {
    const task = await this.taskService.getTaskById(taskId);
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Create a task under the project" })
  @ApiResponse({ status: 200, type: TaskWithRelationsDto })
  async createTask(
    @Query("projectId") projectId: string,
    @Body() dto: CreateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<TaskWithRelationsDto> {
    const creator = await this.taskActorService.getOrCreateHostActor({ userId: req.user.userId });

    return await this.taskService.createTask(
      {
        ...dto,
        projectId,
        creatorId: creator.id,
      },
      { actorId: creator.id, displayName: creator.displayName ?? undefined, userId: req.user.userId },
    );
  }

  @Post("batch")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Batch create tasks under the project" })
  @ApiResponse({ status: 200, type: BatchCreateTasksResultDto })
  async createTasksBatch(
    @Body() dto: CreateTasksBatchRequestDto,
    @Req() req: UserRequest,
  ): Promise<BatchCreateTasksResultDto> {
    return await this.taskService.createTasksBatch(dto, { userId: req.user.userId });
  }

  @Patch(":taskId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Update a task (validated status transitions)" })
  @ApiResponse({ status: 200, type: TaskWithRelationsDto })
  async updateTask(
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<TaskWithRelationsDto> {
    const operator = await this.taskActorService.getOrCreateHostActor({ userId: req.user.userId });
    return await this.taskService.updateTask(taskId, dto, {
      actorId: operator.id,
      displayName: operator.displayName ?? undefined,
      userId: req.user.userId,
    });
  }

  @Delete(":taskId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Soft delete a task" })
  @ApiResponse({ status: 200, type: TaskWithRelationsDto })
  async deleteTask(@Param("taskId") taskId: string, @Req() req: UserRequest): Promise<TaskWithRelationsDto> {
    const operator = await this.taskActorService.getOrCreateHostActor({ userId: req.user.userId });
    return await this.taskService.deleteTask(taskId, {
      actorId: operator.id,
      displayName: operator.displayName ?? undefined,
    });
  }
}
