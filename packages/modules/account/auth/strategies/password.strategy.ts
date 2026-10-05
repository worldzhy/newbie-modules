import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import type { Request } from "express";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { UserService } from "@modules/account/modules/user/user.service";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { UserStatus } from "@generated/prisma/client";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "../login-audit";

@Injectable()
export class PasswordStrategy extends PassportStrategy(Strategy, "local.password") {
  constructor(
    private readonly userService: UserService,
    private readonly auditLogService: AuditLogService,
  ) {
    super({
      usernameField: "account",
      passwordField: "password",
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
  async validate(request: Request, account: string, password: string): Promise<{ userId: string }> {
    // [step 1] Get the user.
    const user = await this.userService.findByAccount(account);
    if (!user) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: null,
        detail: { account, reason: "unknown_account" },
      });
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 2] Check if the account is active.
    if (user.status === UserStatus.INACTIVE) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, reason: "inactive_user" },
      });
      throw new NewbieException(NewbieExceptionType.Login_InactiveUser);
    }

    // [step 3] Handle no password situation.
    if (!user.password) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, reason: "no_password" },
      });
      throw new NewbieException(NewbieExceptionType.Login_NoPassword);
    }

    // [step 4] Validate password.
    const match = await compareHash(password, user.password);
    if (match !== true) {
      await recordLoginFailure(this.auditLogService, {
        request,
        actorId: user.id,
        detail: { account, reason: "wrong_password" },
      });
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 5] OK.
    return { userId: user.id };
  }
}
