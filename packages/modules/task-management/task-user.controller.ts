import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { UserRequest } from "@modules/security/security.interface";
import { TaskUserService } from "./task-user.service";
import {
  LinkTaskUserRequestDto,
  LinkTaskUserResponseDto,
  TaskUserDataResponseDto,
  TaskUsersListResponseDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-users")
export class TaskUserController {
  constructor(private readonly taskUserService: TaskUserService) {}

  @Get()
  @ApiOperation({ summary: "List all TaskUsers" })
  @ApiResponse({ status: 200, type: TaskUsersListResponseDto })
  async listTaskUsers(): Promise<TaskUsersListResponseDto> {
    const taskUsers = await this.taskUserService.listTaskUsers();
    return { success: true, data: taskUsers };
  }

  @Get("me")
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

  @Post("link")
  @ApiOperation({ summary: "Link current Nightwatch user to a TaskUser" })
  @ApiResponse({ status: 200, type: LinkTaskUserResponseDto })
  async linkTaskUser(@Body() dto: LinkTaskUserRequestDto, @Req() req: UserRequest): Promise<LinkTaskUserResponseDto> {
    try {
      const userId = req.user.userId;
      const result = await this.taskUserService.linkTaskUser(userId, dto.taskUserId);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message };
    }
  }

  @Post("unlink")
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
}
