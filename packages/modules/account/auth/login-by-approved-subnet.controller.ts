import {
  Controller,
  Post,
  Body,
  Res,
  Ip,
  Headers,
  UnprocessableEntityException,
  NotFoundException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { NO_TOKEN_PROVIDED, USER_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { AuthService } from "@modules/account/auth/auth.service";
import { ApprovedSubnetService } from "@modules/account/modules/approved-subnet/approved-subnet.service";
import { TokenService } from "@modules/security/token/token.service";
import { TokenSubject } from "@modules/security/token/token.constants";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import { LoginByApprovedSubnetRequestDto, LoginByPasswordResponseDto } from "@modules/account/auth/auth.dto";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "@modules/account/auth/login-audit";

@ApiTags("Account / Auth")
@Controller("auth")
export class LoginByApprovedSubnetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly approvedSubnetService: ApprovedSubnetService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("login-by-approve-subnet")
  @NoGuard()
  @ApiOperation({ summary: "Login by approving a new subnet via token" })
  @ApiResponse({ type: LoginByPasswordResponseDto })
  async loginByApproveSubnet(
    @Ip() ipAddress: string,
    @Headers("User-Agent") userAgent: string,
    @Body() body: LoginByApprovedSubnetRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // [step 1] Verify token
    const { token } = body;
    if (!token) throw new UnprocessableEntityException(NO_TOKEN_PROVIDED);
    let userId: string;
    try {
      ({ userId } = this.tokenService.verify<{ userId: string }>({
        token,
        options: {
          subject: TokenSubject.APPROVE_SUBNET_TOKEN,
        },
      }));
    } catch (error) {
      // Token forgery/replay is a login rejection worth auditing even though
      // no identity could be resolved from it.
      await recordLoginFailure(this.auditLogService, {
        actorId: null,
        ipAddress,
        userAgent,
        detail: { reason: "invalid_approve_subnet_token" },
      });
      throw error;
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await recordLoginFailure(this.auditLogService, {
        actorId: userId,
        ipAddress,
        userAgent,
        detail: { reason: "user_not_found" },
      });
      throw new NotFoundException(USER_NOT_FOUND);
    }

    // [step 2] Approve new subnet
    await this.approvedSubnetService.approveNewSubnet(userId, ipAddress);

    // [step 3] Log in
    return await this.authService.login({
      ipAddress,
      userAgent,
      userId,
      response,
    });
  }

  /* End */
}
