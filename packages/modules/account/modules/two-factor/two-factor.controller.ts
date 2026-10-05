import { Body, Controller, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { UserRequest } from "@modules/security/security.interface";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { DisableTwoFactorDto, EnableTwoFactorDto } from "./two-factor.dto";
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
  @ApiOperation({ summary: "Begin TOTP enrollment; returns QR code and secret" })
  @ApiResponse({ status: 200, description: "Pending enrollment with QR code data URL." })
  async setup(@Req() request: UserRequest) {
    return await this.twoFactorService.setup(request.user.userId);
  }

  @Post("enable")
  @ApiOperation({ summary: "Confirm TOTP code and enable two-factor authentication" })
  async enable(@Req() request: UserRequest, @Body() body: EnableTwoFactorDto) {
    const result = await this.twoFactorService.enable(request.user.userId, body.code);
    await this.auditLogService.record(AuditEvent.MFA_ENABLED, { actorId: request.user.userId });
    return result;
  }

  @Post("disable")
  @ApiOperation({ summary: "Disable two-factor authentication" })
  async disable(@Req() request: UserRequest, @Body() body: DisableTwoFactorDto) {
    await this.twoFactorService.disable(request.user.userId, body);
    await this.auditLogService.record(AuditEvent.MFA_DISABLED, { actorId: request.user.userId });
    return { message: "Two-factor authentication disabled." };
  }
}
