import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserRequest } from "@modules/security/security.interface";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { DisableTwoFactorDto, EnableTwoFactorDto, SetupTwoFactorDto } from "./two-factor.dto";
import { TwoFactorService } from "./two-factor.service";

@ApiTags("Account / Two-factor")
@ApiBearerAuth()
@Controller("account/two-factor")
export class TwoFactorController {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("setup")
  @RequireOwner()
  @ApiOperation({
    summary:
      "Begin TOTP enrollment (or re-bind). Returns QR code and secret. If TOTP is already enabled, the current password or a valid code is required.",
  })
  @ApiResponse({ status: 200, description: "Pending enrollment with QR code data URL." })
  async setup(@Req() request: UserRequest, @Body() body: SetupTwoFactorDto = {}) {
    return await this.twoFactorService.setup(request.user.userId, body);
  }

  @Post("enable")
  @RequireOwner()
  @ApiOperation({ summary: "Confirm TOTP code and enable two-factor authentication" })
  @ApiOkResponse()
  async enable(@Req() request: UserRequest, @Body() body: EnableTwoFactorDto) {
    const wasRebind = await this.twoFactorService.isTotpEnabled(request.user.userId);
    const result = await this.twoFactorService.enable(request.user.userId, body.code);
    await this.auditLogService.record(wasRebind ? AuditEvent.MFA_REBOUND : AuditEvent.MFA_ENABLED, {
      actorId: request.user.userId,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return result;
  }

  @Post("disable")
  @RequireOwner()
  @ApiOperation({ summary: "Disable two-factor authentication" })
  @ApiOkResponse()
  async disable(@Req() request: UserRequest, @Body() body: DisableTwoFactorDto) {
    await this.twoFactorService.disable(request.user.userId, body);
    await this.auditLogService.record(AuditEvent.MFA_DISABLED, {
      actorId: request.user.userId,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return { message: "Two-factor authentication disabled." };
  }
}
