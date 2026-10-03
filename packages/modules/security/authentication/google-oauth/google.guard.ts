import { BadRequestException, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { GuardType } from "../guard.types";
import { CookieName, CookieService } from "../../cookie/cookie.service";

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
      this.cookieService.clearGoogleOAuthState(response);
      if (typeof queryState !== "string" || !cookieState || queryState !== cookieState) {
        throw new BadRequestException("Google OAuth state verification failed.");
      }
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
    const stateCookie = this.cookieService.generateForGoogleOAuthState(state);
    response.cookie(stateCookie.name, stateCookie.value, stateCookie.options);
    return { state, session: false };
  }

  handleRequest(err: BadRequestException, user: any) {
    if (err) throw new BadRequestException("Google authorization verification failed");
    return user;
  }
}
