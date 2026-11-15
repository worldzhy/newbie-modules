import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ExtractJwt } from "passport-jwt";
import { Request } from "express";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { GuardType } from "../guard.types";

@Injectable()
export class JwtAuthGuard extends AuthGuard(GuardType.JWT) {
  /**
   * Passport rejects a bad token before `validate()` runs, so an expired access
   * token would otherwise surface as an unlabelled 401. Only expiry carries the
   * refreshable code (ADR-048); every other verification failure keeps the
   * default behaviour, which terminates the session client-side.
   *
   * The same early rejection means the "no credential" case never reaches
   * `validate()`. Re-run the strategy's own extractor here: when it finds no
   * bearer token the request carried no credential at all, which is
   * Session_Missing (1105) rather than a generic 401.
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

    if (!err && !user) {
      const request = context.switchToHttp().getRequest<Request>();
      if (!ExtractJwt.fromAuthHeaderAsBearerToken()(request)) {
        throw new NewbieException(NewbieExceptionType.Session_Missing);
      }
    }

    return super.handleRequest(err, user, info, context, status);
  }
}
