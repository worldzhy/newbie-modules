import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { AuditLogListResponseDto, AuditLogQueryDto } from "./audit-log.dto";
import { AuditLogService } from "./audit-log.service";

/**
 * Platform audit trail. The list endpoint is admin-only: the global
 * AuthorizationGuard evaluates the requirement against the bound permission
 * authorizer, where the ADMIN role passes everything and other actors need
 * an explicit Permission grant on AuditLog.
 */
@ApiTags("Audit")
@ApiBearerAuth()
@Controller("audit-logs")
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.AuditLog)
  @ApiOperation({ summary: "List audit logs (admin only)" })
  @ApiResponse({ type: AuditLogListResponseDto })
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return await this.auditLogService.findMany(query);
  }
}
