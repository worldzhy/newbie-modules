import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req, BadRequestException, Query } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { TaskService } from "./task.service";
import { TaskGroupService } from "./task-group.service";
import { TaskProjectService } from "./task-project.service";
import { TaskUserService } from "./task-user.service";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreateGroupDto,
  CreateTaskApiDto,
  CreateTaskResponseDto,
  LinkTaskProjectDto,
  LinkTaskProjectResponseDto,
  LinkTaskUserDto,
  LinkTaskUserResponseDto,
  ListTasksQueryDto,
  MembersResponseDto,
  TaskGroupDto,
  TaskGroupWithCountDto,
  TaskDto,
  TaskProjectDataResponseDto,
  TaskProjectsListResponseDto,
  TaskUserDataResponseDto,
  TaskUsersListResponseDto,
  TasksResponseDto,
  UnlinkTaskProjectDto,
  UpdateTaskApiDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("tasks")
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskGroupService: TaskGroupService,
    private readonly taskProjectService: TaskProjectService,
    private readonly taskUserService: TaskUserService,
  ) {}

  @Get("users")
  @ApiOperation({ summary: "List all TaskUsers" })
  @ApiResponse({ status: 200, type: TaskUsersListResponseDto })
  async listTaskUsers(): Promise<TaskUsersListResponseDto> {
    const taskUsers = await this.taskUserService.listTaskUsers();
    return { success: true, data: taskUsers };
  }

  @Get("users/me")
  @ApiOperation({ summary: "Get the TaskUser linked to the current Nightwatch user" })
  @ApiResponse({ status: 200, type: TaskUserDataResponseDto })
  async getLinkedTaskUser(@Req() req: UserRequest): Promise<TaskUserDataResponseDto> {
    const userId = req.user.userId;
    if (!userId) {
      throw new BadRequestException("User ID not found in request");
    }
    const taskUser = await this.taskUserService.getTaskUserByUserId(userId);
    return { success: true, data: taskUser };
  }

  @Post("users/link")
  @ApiOperation({ summary: "Link current Nightwatch user to a TaskUser" })
  @ApiResponse({ status: 200, type: LinkTaskUserResponseDto })
  async linkTaskUser(@Body() dto: LinkTaskUserDto, @Req() req: UserRequest): Promise<LinkTaskUserResponseDto> {
    try {
      const userId = req.user.userId;
      const result = await this.taskUserService.linkTaskUser(userId, dto.taskUserId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Post("users/unlink")
  @ApiOperation({ summary: "Unlink current Nightwatch user from their TaskUser" })
  @ApiResponse({ status: 200, type: LinkTaskUserResponseDto })
  async unlinkTaskUser(@Req() req: UserRequest): Promise<LinkTaskUserResponseDto> {
    try {
      const userId = req.user.userId;
      const result = await this.taskUserService.unlinkTaskUser(userId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Get("projects")
  @ApiOperation({ summary: "List all TaskProjects" })
  @ApiResponse({ status: 200, type: TaskProjectsListResponseDto })
  async listTaskProjects(): Promise<TaskProjectsListResponseDto> {
    const taskProjects = await this.taskProjectService.listTaskProjects();
    return { success: true, data: taskProjects };
  }

  @Get("projects/linked/:projectId")
  @ApiOperation({ summary: "Get the TaskProject linked to the given Nightwatch project" })
  @ApiResponse({ status: 200, type: TaskProjectDataResponseDto })
  async getLinkedTaskProject(@Param("projectId") projectId: string): Promise<TaskProjectDataResponseDto> {
    const taskProject = await this.taskProjectService.getTaskProjectByProjectId(projectId);
    return { success: true, data: taskProject };
  }

  @Post("projects/link")
  @ApiOperation({ summary: "Link Nightwatch project to a TaskProject" })
  @ApiResponse({ status: 200, type: LinkTaskProjectResponseDto })
  async linkTaskProject(@Body() dto: LinkTaskProjectDto): Promise<LinkTaskProjectResponseDto> {
    try {
      const result = await this.taskProjectService.linkTaskProject(dto.projectId, dto.taskProjectId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Post("projects/unlink")
  @ApiOperation({ summary: "Unlink Nightwatch project from its TaskProject" })
  @ApiResponse({ status: 200, type: LinkTaskProjectResponseDto })
  async unlinkTaskProject(@Body() dto: UnlinkTaskProjectDto): Promise<LinkTaskProjectResponseDto> {
    try {
      const result = await this.taskProjectService.unlinkTaskProject(dto.projectId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Post("groups")
  @ApiOperation({ summary: "Create or update a Task Project Group" })
  @ApiResponse({ status: 200, type: TaskGroupDto })
  async createGroup(@Body() dto: CreateGroupDto): Promise<TaskGroupDto> {
    return await this.taskGroupService.createOrUpdateGroup(dto);
  }

  @Get("groups")
  @ApiOperation({ summary: "List all Task Project Groups" })
  @ApiResponse({ status: 200, type: [TaskGroupWithCountDto] })
  async listGroups(): Promise<TaskGroupWithCountDto[]> {
    return await this.taskGroupService.listGroups();
  }

  @Get("projects/:projectId/members")
  @ApiOperation({ summary: "List project members by Nightwatch projectId" })
  @ApiResponse({ status: 200, type: MembersResponseDto })
  async listProjectMembers(@Param("projectId") projectId: string): Promise<MembersResponseDto> {
    const members = await this.taskUserService.listTaskUsersByProjectId(projectId);
    return { success: true, data: members };
  }

  @Get("projects/:projectId/items")
  @ApiOperation({ summary: "List tasks by Nightwatch projectId" })
  @ApiResponse({ status: 200, type: TasksResponseDto })
  async listTasksByProjectId(
    @Param("projectId") projectId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<TasksResponseDto> {
    const page = query.page ?? 0;
    const pageSize = query.pageSize ?? 10;

    // 1. Find the linked taskProjectId
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
    const result = await this.taskService.listTasks(
      taskProject.groupId,
      query.status,
      query.keyword,
      query.assigneeName,
      taskProject.id,
      true, // includeCompleted
      page * pageSize,
      pageSize,
    );

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

  @Post("projects/:projectId/items")
  @ApiOperation({ summary: "Create a new task for a project" })
  @ApiResponse({ status: 200, type: CreateTaskResponseDto })
  async createTask(
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskApiDto,
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

  @Patch("items/:taskId")
  @ApiOperation({ summary: "Update a task" })
  @ApiResponse({ status: 200, type: TaskDto })
  async updateTask(
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskApiDto,
    @Req() req: UserRequest,
  ): Promise<TaskDto> {
    const operator = {
      id: req.user.userId,
      name: req.user.userId,
      source: "SYSTEM",
    };

    return await this.taskService.updateTask(taskId, {
      ...dto,
      lastOperatorId: operator.id,
      lastOperatorName: operator.name,
      lastOperatorSource: operator.source,
    });
  }

  @Post("items/:taskId/delete")
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
