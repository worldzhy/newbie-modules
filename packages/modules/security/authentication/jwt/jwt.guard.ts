import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { GuardType } from "../guard.types";

@Injectable()
export class JwtAuthGuard extends AuthGuard(GuardType.JWT) {
  /**
   * Passport rejects a bad token before `validate()` runs, so an expired access
   * token would otherwise surface as an unlabelled 401. Only expiry carries the
   * refreshable code (ADR-048); every other verification failure keeps the
   * default behaviour, which terminates the session client-side.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    if (info instanceof Error && info.name === "TokenExpiredError") {
      throw new NewbieException(NewbieExceptionType.Session_AccessExpired);
    }

    return super.handleRequest(err, user, info, context, status);
  }
}
