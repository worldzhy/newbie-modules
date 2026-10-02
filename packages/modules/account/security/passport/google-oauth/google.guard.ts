import { BadRequestException, ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { randomUUID } from "crypto";
import { Request, Response } from "express";
import { GuardType } from "../guard.types";
import { CookieName, CookieService } from "../cookie/cookie.service";

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
      return super.canActivate(context);
    }

    // Start of the handshake. Bind a random state in a short-lived cookie and
    // ask Google to echo the same value with the callback.
    const state = randomUUID();
    const stateCookie = this.cookieService.generateForGoogleOAuthState(state);
    response.cookie(stateCookie.name, stateCookie.value, stateCookie.options);
    const authenticateHandler = this.authenticate({ state, session: false });
    return new Promise<boolean>((resolve, reject) => {
      authenticateHandler(request, response, (error?: unknown) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  }

  handleRequest(err: BadRequestException, user: any) {
    if (err) throw new BadRequestException("Google authorization verification failed");
    return user;
  }
}
