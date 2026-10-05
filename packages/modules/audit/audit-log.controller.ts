import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { SelfOnlyGuard } from "@modules/security/self-only/self-only.guard";
import { AuditLogListResponseDto, AuditLogQueryDto } from "./audit-log.dto";
import { AuditLogService } from "./audit-log.service";

@ApiTags("Audit")
@ApiBearerAuth()
@Controller()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /** Get audit logs for an organization */
  @Get("organizations/:organizationId/audit-logs")
  @UseGuards(SelfOnlyGuard)
  @ApiOperation({ summary: "Get audit logs for an organization" })
  @ApiResponse({ type: AuditLogListResponseDto })
  async getAuditLogsByOrganization(
    @Param("organizationId") organizationId: string,
    @Query() query: AuditLogQueryDto,
  ) {
    return await this.auditLogService.findMany({ organizationId }, query);
  }

  /** Get audit logs for a user */
  @Get("users/:userId/audit-logs")
  @UseGuards(SelfOnlyGuard)
  @ApiOperation({ summary: "Get audit logs for a user" })
  @ApiResponse({ type: AuditLogListResponseDto })
  async getAuditLogsByUser(
    @Param("userId") userId: string,
    @Query() query: AuditLogQueryDto,
  ) {
    return await this.auditLogService.findMany({ actorId: userId }, query);
  }
}
