import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import { TaskParticipantService } from "./task-participant.service";
import { LookupParticipantQueryDto, TaskParticipantDataResponseDto, ListTaskParticipantsResponseDto } from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-participants")
export class TaskParticipantController {
  constructor(private readonly taskParticipantService: TaskParticipantService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TaskParticipant)
  @ApiOperation({ summary: "List task participants within the caller's projects" })
  @ApiResponse({ status: 200, type: ListTaskParticipantsResponseDto })
  async listParticipants(@Req() req: UserRequest): Promise<ListTaskParticipantsResponseDto> {
    const participants = await this.taskParticipantService.listParticipants(req.user.userId);
    return { success: true, data: participants };
  }

  @Get("by-external-id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TaskParticipant)
  @ApiOperation({ summary: "Look up a participant by external ID" })
  @ApiResponse({ status: 200, type: TaskParticipantDataResponseDto })
  async getParticipantByExternalId(
    @Query() query: LookupParticipantQueryDto,
    @Req() req: UserRequest,
  ): Promise<TaskParticipantDataResponseDto> {
    const participant = await this.taskParticipantService.getParticipantByExternalId(query.externalId, req.user.userId);
    return { success: true, data: participant };
  }
}
