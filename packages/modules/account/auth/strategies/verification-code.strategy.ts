import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import type { Request } from "express";
import { UserStatus, VerificationCodeUse } from "@generated/prisma/client";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { VerificationCodeService } from "@modules/account/modules/verification-code/verification-code.service";
import { UserService } from "@modules/account/modules/user/user.service";
import { verifyEmail, verifyPhone } from "@modules/account/helpers/validator";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "../login-audit";

@Injectable()
export class VerificationCodeStrategy extends PassportStrategy(Strategy, "local.verification-code") {
  constructor(
    private readonly verificationCodeService: VerificationCodeService,
    private readonly userService: UserService,
    private readonly auditLogService: AuditLogService,
  ) {
    super({
      usernameField: "account",
      passwordField: "verificationCode",
      // The request carries the client IP and User-Agent used to attribute
      // failed login attempts in the audit trail.
      passReqToCallback: true,
    });
  }

  /**
   * 'vaidate' function must be implemented.
   *
   * The 'account' parameter accepts:
   * [1] email
   * [2] phone
   *
   */
  async validate(request: Request, account: string, verificationCode: string): Promise<{ userId: string }> {
    const channel: "email" | "phone" | "unknown" = verifyEmail(account)
      ? "email"
      : verifyPhone(account)
        ? "phone"
        : "unknown";

    // [step 1] Get the user.
    const user = await this.userService.findByAccount(account);
    if (!user) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: null,
        detail: { account, channel, reason: "unknown_account" },
      });
      throw new UnauthorizedException("The user does not exist.");
    }

    // [step 2] Check if the account is active, mirroring the password strategy.
    if (user.status === UserStatus.INACTIVE) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, channel, reason: "inactive_user" },
      });
      throw new NewbieException(NewbieExceptionType.Login_InactiveUser);
    }

    // [step 3] Handle invalid account situation.
    if (!verifyEmail(account) && !verifyPhone(account)) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, channel, reason: "invalid_account" },
      });
      throw new UnauthorizedException("Invalid account.");
    }

    // [step 4] Validate verification code.
    // Only a code issued for the login purpose can complete the login.
    const isCodeValid = verifyEmail(account)
      ? await this.verificationCodeService.validateForEmail(
          verificationCode,
          account,
          VerificationCodeUse.LOGIN_BY_EMAIL,
        )
      : await this.verificationCodeService.validateForPhone(
          verificationCode,
          account,
          VerificationCodeUse.LOGIN_BY_PHONE,
        );
    if (!isCodeValid) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, channel, reason: "invalid_code" },
      });
      throw new UnauthorizedException("Invalid code.");
    }

    // [step 5] Inactivate the used code to prevent replay attacks.
    if (verifyEmail(account)) {
      await this.verificationCodeService.inactivateForEmail(account, VerificationCodeUse.LOGIN_BY_EMAIL);
    } else {
      await this.verificationCodeService.inactivateForPhone(account, VerificationCodeUse.LOGIN_BY_PHONE);
    }

    // [step 6] OK.
    return { userId: user.id };
  }
}
