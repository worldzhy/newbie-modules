import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@modules/security/authentication/jwt/jwt.guard";
import { TaskParticipantService } from "./task-participant.service";
import { LookupParticipantQueryDto, TaskParticipantDataResponseDto, TaskParticipantsListResponseDto } from "./task.dto";

@ApiTags("Task Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("task-participants")
export class TaskParticipantController {
  constructor(private readonly taskParticipantService: TaskParticipantService) {}

  @Get()
  @ApiOperation({ summary: "List all task participants" })
  @ApiResponse({ status: 200, type: TaskParticipantsListResponseDto })
  async listParticipants(): Promise<TaskParticipantsListResponseDto> {
    const participants = await this.taskParticipantService.listParticipants();
    return { success: true, data: participants };
  }

  @Get("by-identity")
  @ApiOperation({ summary: "Look up a participant by identity source and external ID" })
  @ApiResponse({ status: 200, type: TaskParticipantDataResponseDto })
  async getParticipantByIdentity(@Query() query: LookupParticipantQueryDto): Promise<TaskParticipantDataResponseDto> {
    const participant = await this.taskParticipantService.getParticipantByIdentity(
      query.identitySource,
      query.externalId,
    );
    return { success: true, data: participant };
  }
}
