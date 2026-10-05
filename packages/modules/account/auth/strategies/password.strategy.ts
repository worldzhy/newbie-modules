import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-local";
import type { Request } from "express";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { UserService } from "@modules/account/modules/user/user.service";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { UserStatus } from "@generated/prisma/client";
import { AuditActorType, AuditEvent, AuditLogService, AuditResult } from "@modules/audit/audit-log.service";

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
      await this.recordFailure(request, { account, reason: "unknown_account", actorId: null });
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 2] Check if the account is active.
    if (user.status === UserStatus.INACTIVE) {
      await this.recordFailure(request, { account, reason: "inactive_user", actorId: user.id });
      throw new NewbieException(NewbieExceptionType.Login_InactiveUser);
    }

    // [step 3] Handle no password situation.
    if (!user.password) {
      await this.recordFailure(request, { account, reason: "no_password", actorId: user.id });
      throw new NewbieException(NewbieExceptionType.Login_NoPassword);
    }

    // [step 4] Validate password.
    const match = await compareHash(password, user.password);
    if (match !== true) {
      await this.recordFailure(request, { account, reason: "wrong_password", actorId: user.id });
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 5] OK.
    return { userId: user.id };
  }

  /**
   * Persist the failed attempt before the auth exception propagates. Guards
   * run before the global audit interceptor, so a rejected login would leave
   * no trail unless the strategy records it explicitly.
   */
  private async recordFailure(
    request: Request,
    params: { account: string; reason: string; actorId: string | null },
  ): Promise<void> {
    await this.auditLogService.record(AuditEvent.LOGIN_FAILED, {
      actorType: params.actorId ? AuditActorType.USER : undefined,
      actorId: params.actorId,
      result: AuditResult.FAILURE,
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      detail: { account: params.account, reason: params.reason },
    });
  }
}
