import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { TaskActorService } from "./task-actor.service";
import {
  ListTaskActorsResponseDto,
  LookupActorByCrewmateIdQueryDto,
  LookupActorByUserIdQueryDto,
  MembersResponseDto,
  TaskActorDataResponseDto,
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
  @ApiResponse({ status: 200, type: ListTaskActorsResponseDto })
  async listActors(): Promise<ListTaskActorsResponseDto> {
    const actors = await this.taskActorService.listActors();
    return { success: true, data: actors };
  }

  @Get("by-user-id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "Look up a HUMAN actor by host user ID" })
  @ApiResponse({ status: 200, type: TaskActorDataResponseDto })
  async getActorByUserId(@Query() query: LookupActorByUserIdQueryDto): Promise<TaskActorDataResponseDto> {
    const actor = await this.taskActorService.getActorByUserId(query.userId);
    return { success: true, data: actor };
  }

  @Get("by-crewmate-id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "Look up a CREWMATE actor by crewmate ID" })
  @ApiResponse({ status: 200, type: TaskActorDataResponseDto })
  async getActorByCrewmateId(@Query() query: LookupActorByCrewmateIdQueryDto): Promise<TaskActorDataResponseDto> {
    const actor = await this.taskActorService.getActorByCrewmateId(query.crewmateId);
    return { success: true, data: actor };
  }

  @Get("members")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskActor)
  @ApiOperation({ summary: "List project actors with task stats by projectId" })
  @ApiResponse({ status: 200, type: MembersResponseDto })
  async listProjectMembers(@Query("projectId") projectId: string): Promise<MembersResponseDto> {
    const members = await this.taskActorService.listActorMembersByProjectId(projectId);
    return { success: true, data: members };
  }
}
