import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { TaskGroupService } from "./task-group.service";
import { CreateGroupRequestDto, TaskGroupDto, TaskGroupWithCountDto } from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-groups")
export class TaskGroupController {
  constructor(private readonly taskGroupService: TaskGroupService) {}

  @Post()
  @ApiOperation({ summary: "Create or update a task group by chatId" })
  @ApiResponse({ status: 200, type: TaskGroupDto })
  async createGroup(@Body() dto: CreateGroupRequestDto): Promise<TaskGroupDto> {
    return await this.taskGroupService.createOrUpdateGroup(dto);
  }

  @Get()
  @ApiOperation({ summary: "List all task groups with task counts" })
  @ApiResponse({ status: 200, type: [TaskGroupWithCountDto] })
  async listGroups(): Promise<TaskGroupWithCountDto[]> {
    return await this.taskGroupService.listGroups();
  }
}
