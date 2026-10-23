import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { TaskSpaceService } from "./task-space.service";
import { TaskService } from "./task.service";
import { TaskParticipantService } from "./task-participant.service";
import {
  CreateTaskRequestDto,
  CreateTaskResponseDto,
  ListTasksQueryDto,
  MembersResponseDto,
  TaskSpaceResponseDto,
  TaskSpaceWithCountDto,
  TasksResponseDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-spaces")
export class TaskSpaceController {
  constructor(
    private readonly taskSpaceService: TaskSpaceService,
    private readonly taskService: TaskService,
    private readonly taskParticipantService: TaskParticipantService,
  ) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskSpace)
  @ApiOperation({ summary: "List the task spaces whose owning Project the caller is a member of" })
  @ApiResponse({ status: 200, type: [TaskSpaceWithCountDto] })
  async listSpaces(@Req() req: UserRequest): Promise<TaskSpaceWithCountDto[]> {
    return await this.taskSpaceService.listSpacesForUser(req.user.userId);
  }

  @Get("by-project/:projectId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskSpace)
  @ApiOperation({ summary: "Get (auto-provisioning on first access) the task space of a Nightwatch project" })
  @ApiResponse({ status: 200, type: TaskSpaceResponseDto })
  async getSpaceByProjectId(@Param("projectId") projectId: string): Promise<TaskSpaceResponseDto> {
    const space = await this.taskSpaceService.ensureSpaceForProject(projectId);
    return { success: true, data: space };
  }

  @Get("by-project/:projectId/tasks")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Task)
  @ApiOperation({ summary: "List tasks of a Nightwatch project (companion task space is ensured)" })
  @ApiResponse({ status: 200, type: TasksResponseDto })
  async listTasksByProjectId(
    @Param("projectId") projectId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<TasksResponseDto> {
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 10;

    const space = await this.taskSpaceService.ensureSpaceForProject(projectId);

    const result = await this.taskService.listTasks({
      spaceId: space.id,
      status: query.status,
      keyword: query.keyword,
      assigneeName: query.assigneeName,
      includeCompleted: true,
      skip: page * pageSize,
      take: pageSize,
    });

    return {
      success: true,
      data: {
        records: result?.tasks || [],
        total: result?.total || 0,
        page,
        pageSize,
      },
    };
  }

  @Post("by-project/:projectId/tasks")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Task)
  @ApiOperation({ summary: "Create a task under the Nightwatch project (companion task space is ensured)" })
  @ApiResponse({ status: 200, type: CreateTaskResponseDto })
  async createTask(
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<CreateTaskResponseDto> {
    const space = await this.taskSpaceService.ensureSpaceForProject(projectId);
    const creator = await this.taskParticipantService.ensureHostParticipant({
      userId: req.user.userId,
    });

    const result = await this.taskService.createTask({
      ...dto,
      spaceId: space.id,
      creatorId: creator.id,
    });
    return { success: true, data: result };
  }

  @Get("by-project/:projectId/members")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskSpace)
  @ApiOperation({ summary: "List project participants with task stats by Nightwatch projectId" })
  @ApiResponse({ status: 200, type: MembersResponseDto })
  async listProjectMembers(@Param("projectId") projectId: string): Promise<MembersResponseDto> {
    const members = await this.taskParticipantService.listParticipantsByProjectId(projectId);
    return { success: true, data: members };
  }
}
