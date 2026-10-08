import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { UserRequest } from "@modules/security/security.interface";
import { TaskSpaceService } from "./task-space.service";
import { TaskService } from "./task.service";
import { HOST_IDENTITY_SOURCE, TaskParticipantService } from "./task-participant.service";
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
  @ApiOperation({ summary: "List all task spaces with task counts" })
  @ApiResponse({ status: 200, type: [TaskSpaceWithCountDto] })
  async listSpaces(): Promise<TaskSpaceWithCountDto[]> {
    return await this.taskSpaceService.listSpaces();
  }

  @Get("by-project/:projectId")
  @ApiOperation({ summary: "Get (auto-provisioning on first access) the task space of a Nightwatch project" })
  @ApiResponse({ status: 200, type: TaskSpaceResponseDto })
  async getSpaceByProjectId(@Param("projectId") projectId: string): Promise<TaskSpaceResponseDto> {
    const space = await this.taskSpaceService.ensureSpaceForProject(projectId);
    return { success: true, data: space };
  }

  @Get("by-project/:projectId/tasks")
  @ApiOperation({ summary: "List tasks of a Nightwatch project (companion task space is ensured)" })
  @ApiResponse({ status: 200, type: TasksResponseDto })
  async listTasksByProjectId(
    @Param("projectId") projectId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<TasksResponseDto> {
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 10;

    // Every project implicitly owns its companion TaskSpace.
    await this.taskSpaceService.ensureSpaceForProject(projectId);

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
  @ApiOperation({ summary: "Create a task under the Nightwatch project (companion task space is ensured)" })
  @ApiResponse({ status: 200, type: CreateTaskResponseDto })
  async createTask(
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<CreateTaskResponseDto> {
    const space = await this.taskSpaceService.ensureSpaceForProject(projectId);
    const creator = await this.taskParticipantService.ensureParticipant({
      identitySource: HOST_IDENTITY_SOURCE,
      externalId: req.user.userId,
    });

    const result = await this.taskService.createTask({
      ...dto,
      spaceId: space.id,
      projectId,
      creatorId: creator.id,
    });
    return { success: true, data: result };
  }

  @Get("by-project/:projectId/members")
  @ApiOperation({ summary: "List project participants with task stats by Nightwatch projectId" })
  @ApiResponse({ status: 200, type: MembersResponseDto })
  async listProjectMembers(@Param("projectId") projectId: string): Promise<MembersResponseDto> {
    const members = await this.taskParticipantService.listParticipantsByProjectId(projectId);
    return { success: true, data: members };
  }
}
