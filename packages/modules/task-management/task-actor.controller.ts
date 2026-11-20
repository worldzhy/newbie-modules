import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { TaskActorService } from "./task-actor.service";
import {
  GetTaskActorMembersRequestDto,
  LookupActorByCrewmateIdRequestDto,
  LookupActorByUserIdRequestDto,
  TaskActorListItemResponseDto,
  TaskActorMemberResponseDto,
  TaskActorResponseDto,
} from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-actors")
export class TaskActorController {
  constructor(private readonly taskActorService: TaskActorService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "List task actors" })
  @ApiResponse({ type: TaskActorListItemResponseDto, isArray: true })
  async listActors(): Promise<TaskActorListItemResponseDto[]> {
    return await this.taskActorService.listActors();
  }

  @Get("by-user-id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "Look up a HUMAN actor by host user ID" })
  @ApiResponse({ status: 200, type: TaskActorResponseDto, description: "Returns null when the actor does not exist" })
  async getActorByUserId(@Query() query: LookupActorByUserIdRequestDto): Promise<TaskActorResponseDto | null> {
    return await this.taskActorService.getActorByUserId(query.userId);
  }

  @Get("by-crewmate-id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "Look up a CREWMATE actor by crewmate ID" })
  @ApiResponse({ status: 200, type: TaskActorResponseDto, description: "Returns null when the actor does not exist" })
  async getActorByCrewmateId(@Query() query: LookupActorByCrewmateIdRequestDto): Promise<TaskActorResponseDto | null> {
    return await this.taskActorService.getActorByCrewmateId(query.crewmateId);
  }

  @Get("members")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "List project actors with task stats" })
  @ApiResponse({ type: TaskActorMemberResponseDto, isArray: true })
  async listProjectMembers(@Query() query: GetTaskActorMembersRequestDto): Promise<TaskActorMemberResponseDto[]> {
    return await this.taskActorService.listActorMembersByProjectId(query.projectId);
  }
}
