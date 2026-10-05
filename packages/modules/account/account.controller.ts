import { BadRequestException, Body, Controller, Get, Headers, Ip, Patch, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { VerificationCodeUse } from "@generated/prisma/client";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { UserRequest } from "@modules/security/security.interface";
import { AccountService } from "@modules/account/account.service";
import { verifyEmail, verifyPhone } from "@modules/account/helpers/validator";
import { VerificationCodeService } from "@modules/account/modules/verification-code/verification-code.service";
import { AuditLogService, AuditEvent } from "@modules/audit/audit-log.service";
import { LimitLoginByIp } from "@modules/security/rate-limiter/rate-limiter.decorator";
import { NoGuard } from "@modules/security/authentication/public/public.decorator";
import {
  ChangePasswordDto,
  GetCurrentUserResponseDto,
  PasswordChangeResponseDto,
  ResetPasswordDto,
  UpdateMeDto,
} from "@modules/account/account.dto";

@ApiTags("Account")
@Controller("account")
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get current user information" })
  @ApiResponse({ type: GetCurrentUserResponseDto })
  async getCurrentUser(@Req() request: UserRequest) {
    return await this.accountService.me(request);
  }

  @Patch("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update current user information" })
  @ApiResponse({ type: GetCurrentUserResponseDto })
  async updateCurrentUser(@Req() request: UserRequest, @Body() body: UpdateMeDto) {
    return await this.accountService.updateMe(request, body);
  }

  @ApiBearerAuth()
  @Post("change-password")
  @ApiOperation({ summary: "Change the password of the current user" })
  @ApiResponse({ type: PasswordChangeResponseDto })
  async changePassword(
    @Req() request: UserRequest,
    @Body() body: ChangePasswordDto,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ) {
    // [step 1] Guard statement.
    if (!("currentPassword" in body) || !("newPassword" in body)) {
      throw new BadRequestException("Please carry 'currentPassword' and 'newPassword' in the request body.");
    }

    // [step 2] Verify if the new password is same with the current password.
    if (body.currentPassword.trim() === body.newPassword.trim()) {
      throw new BadRequestException("The new password is same with the current password.");
    }

    // [step 3] The identity always comes from the authenticated session,
    // never from the request body, so one user cannot reset another's
    // password by smuggling a different userId.
    const userId = request.user.userId;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const match = await compareHash(body.currentPassword, user.password);
    if (match === false) {
      throw new BadRequestException("The current password is incorrect.");
    }

    // [step 4] Change password.
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { password: body.newPassword },
      select: { id: true, email: true, phone: true },
    });

    // [step 5] Revoke every other session of this user. A password change
    // commonly follows a compromise, so any session an attacker may hold must
    // stop working. The current session stays alive to avoid forcing an
    // immediate re-login of the user who just changed the password.
    const currentSessionId = request.user.sessionId;
    await this.prisma.session.deleteMany({
      where: {
        userId,
        ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}),
      },
    });

    await this.auditLogService.record(AuditEvent.PASSWORD_CHANGED, {
      actorId: userId,
      ipAddress,
      userAgent,
    });

    return updatedUser;
  }

  @NoGuard()
  @LimitLoginByIp()
  @Post("reset-password")
  @ApiOperation({ summary: "Reset password with email or phone verification code" })
  @ApiResponse({ type: PasswordChangeResponseDto })
  @ApiBody({
    type: ResetPasswordDto,
    description: "",
    examples: {
      a: {
        summary: "Reset password with email",
        value: {
          email: "henry@inceptionpad.com",
          verificationCode: "283749",
          newPassword: "",
        },
      },
      b: {
        summary: "Reset password with phone",
        value: {
          phone: "13260000789",
          verificationCode: "283749",
          newPassword: "",
        },
      },
    },
  })
  async resetPassword(
    @Body()
    body: ResetPasswordDto,
    @Ip() ipAddress: string,
    @Headers("user-agent") userAgent: string,
  ) {
    if (body.email && verifyEmail(body.email)) {
      // Only a code issued for resetting password can complete the reset.
      if (
        await this.verificationCodeService.validateForEmail(
          body.verificationCode,
          body.email,
          VerificationCodeUse.RESET_PASSWORD,
        )
      ) {
        const updated = await this.prisma.user.update({
          where: { email: body.email.toLowerCase() },
          data: { password: body.newPassword },
          select: { id: true, email: true, phone: true },
        });
        // Consume the code so it cannot be replayed for another reset.
        await this.verificationCodeService.inactivateForEmail(body.email, VerificationCodeUse.RESET_PASSWORD);
        // The reset often happens after account takeover: revoke every session
        // of the user, including any session held by an attacker.
        await this.prisma.session.deleteMany({ where: { userId: updated.id } });
        await this.auditLogService.record(AuditEvent.PASSWORD_RESET, {
          actorId: updated.id,
          ipAddress,
          userAgent,
        });
        return updated;
      } else {
        throw new NewbieException(NewbieExceptionType.ResetPassword_InvalidCode);
      }
    } else if (body.phone && verifyPhone(body.phone)) {
      // Only a code issued for resetting password can complete the reset.
      if (
        await this.verificationCodeService.validateForPhone(
          body.verificationCode,
          body.phone,
          VerificationCodeUse.RESET_PASSWORD,
        )
      ) {
        const updated = await this.prisma.user.update({
          where: { phone: body.phone },
          data: { password: body.newPassword },
          select: { id: true, email: true, phone: true },
        });
        // Consume the code so it cannot be replayed for another reset.
        await this.verificationCodeService.inactivateForPhone(body.phone, VerificationCodeUse.RESET_PASSWORD);
        // Revoke every session of the user after a successful reset.
        await this.prisma.session.deleteMany({ where: { userId: updated.id } });
        await this.auditLogService.record(AuditEvent.PASSWORD_RESET, {
          actorId: updated.id,
          ipAddress,
          userAgent,
        });
        return updated;
      } else {
        throw new NewbieException(NewbieExceptionType.ResetPassword_InvalidCode);
      }
    }

    throw new NewbieException(NewbieExceptionType.ResetPassword_WrongInput);
  }

  /* End */
}
