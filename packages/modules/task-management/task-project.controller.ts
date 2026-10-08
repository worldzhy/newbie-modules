import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { UserRequest } from "@modules/security/security.interface";
import { TaskProjectService } from "./task-project.service";
import { TaskService } from "./task.service";
import { TaskUserService } from "./task-user.service";
import {
  CreateTaskRequestDto,
  CreateTaskResponseDto,
  LinkTaskProjectRequestDto,
  LinkTaskProjectResponseDto,
  ListTasksQueryDto,
  MembersResponseDto,
  TaskProjectDataResponseDto,
  TaskProjectsListResponseDto,
  TasksResponseDto,
  UnlinkTaskProjectRequestDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-projects")
export class TaskProjectController {
  constructor(
    private readonly taskProjectService: TaskProjectService,
    private readonly taskService: TaskService,
    private readonly taskUserService: TaskUserService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List all TaskProjects" })
  @ApiResponse({ status: 200, type: TaskProjectsListResponseDto })
  async listTaskProjects(): Promise<TaskProjectsListResponseDto> {
    const taskProjects = await this.taskProjectService.listTaskProjects();
    return { success: true, data: taskProjects };
  }

  @Get("by-project/:projectId")
  @ApiOperation({ summary: "Get the TaskProject linked to the given Nightwatch project" })
  @ApiResponse({ status: 200, type: TaskProjectDataResponseDto })
  async getLinkedTaskProject(@Param("projectId") projectId: string): Promise<TaskProjectDataResponseDto> {
    const taskProject = await this.taskProjectService.getTaskProjectByProjectId(projectId);
    return { success: true, data: taskProject };
  }

  @Post("link")
  @ApiOperation({ summary: "Link Nightwatch project to a TaskProject" })
  @ApiResponse({ status: 200, type: LinkTaskProjectResponseDto })
  async linkTaskProject(@Body() dto: LinkTaskProjectRequestDto): Promise<LinkTaskProjectResponseDto> {
    try {
      const result = await this.taskProjectService.linkTaskProject(dto.projectId, dto.taskProjectId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Post("unlink")
  @ApiOperation({ summary: "Unlink Nightwatch project from its TaskProject" })
  @ApiResponse({ status: 200, type: LinkTaskProjectResponseDto })
  async unlinkTaskProject(@Body() dto: UnlinkTaskProjectRequestDto): Promise<LinkTaskProjectResponseDto> {
    try {
      const result = await this.taskProjectService.unlinkTaskProject(dto.projectId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Get("by-project/:projectId/tasks")
  @ApiOperation({ summary: "List tasks under the TaskProject linked to a Nightwatch project" })
  @ApiResponse({ status: 200, type: TasksResponseDto })
  async listTasksByProjectId(
    @Param("projectId") projectId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<TasksResponseDto> {
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 10;

    // 1. Find the linked taskProject
    const taskProject = await this.taskProjectService.getTaskProjectByProjectId(projectId);

    if (!taskProject) {
      // If not linked, return empty paginated result
      return {
        success: true,
        data: {
          records: [],
          total: 0,
          page,
          pageSize,
        },
      };
    }

    // 2. Fetch tasks for this taskProjectId
    const result = await this.taskService.listTasks({
      groupId: taskProject.groupId,
      status: query.status,
      keyword: query.keyword,
      assigneeName: query.assigneeName,
      taskProjectId: taskProject.id,
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
  @ApiOperation({ summary: "Create a new task under the TaskProject linked to a Nightwatch project" })
  @ApiResponse({ status: 200, type: CreateTaskResponseDto })
  async createTask(
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskRequestDto,
    @Req() req: UserRequest,
  ): Promise<CreateTaskResponseDto> {
    const taskProject = await this.taskProjectService.getTaskProjectByProjectId(projectId);
    if (!taskProject) {
      throw new BadRequestException("Project not linked to any TaskProject");
    }
    const creatorId = req.user.userId;
    const taskUser = await this.taskUserService.getTaskUserByUserId(creatorId);

    const result = await this.taskService.createTask({
      ...dto,
      groupId: taskProject.groupId,
      taskProjectId: taskProject.id,
      creatorId: taskUser?.id,
    });
    return { success: true, data: result };
  }

  @Get("by-project/:projectId/members")
  @ApiOperation({ summary: "List project members with task stats by Nightwatch projectId" })
  @ApiResponse({ status: 200, type: MembersResponseDto })
  async listProjectMembers(@Param("projectId") projectId: string): Promise<MembersResponseDto> {
    const members = await this.taskUserService.listTaskUsersByProjectId(projectId);
    return { success: true, data: members };
  }
}
