import { BadRequestException, ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { GuardType } from "../guard.types";
import { CookieName, CookieService } from "../../cookie/cookie.service";
import { isSafeRedirectPath } from "../../cookie/redirect-path";

@Injectable()
export class GoogleAuthGuard extends AuthGuard(GuardType.GOOGLE) {
  constructor(private readonly cookieService: CookieService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    if (Object.keys(request.query).includes("code")) {
      // Callback request. Verify the state bound when the handshake started,
      // before Passport exchanges the authorization code. A missing or
      // mismatched state indicates a forged or replayed callback (CSRF).
      const queryState = request.query.state;
      const cookieState = request.cookies?.[CookieName.GOOGLE_OAUTH_STATE];
      if (typeof queryState !== "string" || !cookieState || queryState !== cookieState) {
        throw new BadRequestException("Google OAuth state verification failed.");
      }
      // State verified — consume the single-use cookie so the handshake
      // cannot be replayed. A failed verification keeps the cookie intact.
      this.cookieService.clearOAuthCookie(CookieName.GOOGLE_OAUTH_STATE, response);
    }

    return super.canActivate(context);
  }

  /**
   * On the start request, mint the state, store it in a cookie, and pass it to
   * Passport so Google echoes it at the callback. On the callback request only
   * session:false is needed (the state cookie has already been verified).
   */
  getAuthenticateOptions(context: ExecutionContext) {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    if (Object.keys(request.query).includes("code")) {
      return { session: false };
    }

    const response = httpContext.getResponse<Response>();
    const state = randomUUID();
    const stateCookie = this.cookieService.generateForOAuthState(CookieName.GOOGLE_OAUTH_STATE, state);
    response.cookie(stateCookie.name, stateCookie.value, stateCookie.options);

    // Remember where the user was before being bounced to login so the callback
    // can send them back there. Only same-origin relative paths are stored;
    // a handshake started without one clears any stale destination left by an
    // earlier attempt.
    const redirectUrl = request.query.redirectUrl;
    if (isSafeRedirectPath(redirectUrl)) {
      const redirectCookie = this.cookieService.generateForOAuthRedirect(redirectUrl);
      response.cookie(redirectCookie.name, redirectCookie.value, redirectCookie.options);
    } else {
      this.cookieService.clearOAuthCookie(CookieName.OAUTH_REDIRECT_URL, response);
    }

    return { state, session: false };
  }

  private readonly logger = new Logger(GoogleAuthGuard.name);

  handleRequest<TUser>(err: unknown | null, user: TUser): TUser {
    if (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Google OAuth verification failed: ${message}`, stack);
      throw new BadRequestException(`Google authorization verification failed: ${message}`);
    }
    return user;
  }
}
