import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CookieOptions, Response } from "express";
import { TokenService } from "../token/token.service";
import { dateOfUnixTimestamp } from "@devbie/newbie/utilities/datetime.util";

export enum CookieName {
  REFRESH_TOKEN = "refreshToken",
  // Short-lived state binding the Google OAuth start and callback requests.
  GOOGLE_OAUTH_STATE = "googleOAuthState",
  // Short-lived state binding the Lark OAuth start and callback requests.
  LARK_OAUTH_STATE = "larkOAuthState",
}

@Injectable()
export class CookieService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  generateForRefreshToken(refreshToken: string) {
    const refreshTokenInfo = this.tokenService.verifyUserRefreshToken(refreshToken);

    return this.generate({
      name: CookieName.REFRESH_TOKEN,
      value: refreshToken,
      expires: dateOfUnixTimestamp(refreshTokenInfo.exp),
    });
  }

  /**
   * Build the state cookie for an OAuth handshake (Google, Lark, ...). It must
   * be sent on the top-level GET redirect back from the provider, so SameSite
   * is Lax (unlike the refresh token cookie, which stays Strict). The cookie is
   * single-use: consume it only after the callback state has been verified.
   */
  generateForOAuthState(name: CookieName, state: string) {
    return {
      name,
      value: state,
      options: {
        ...this.defaultCookieOptions(),
        sameSite: "lax" as const,
        maxAge: 10 * 60 * 1000,
      },
    };
  }

  /** Expire the state cookie once the OAuth callback has been verified. */
  clearOAuthState(name: CookieName, response: Response) {
    response.cookie(name, "", {
      ...this.defaultCookieOptions(),
      sameSite: "lax" as const,
      maxAge: 0,
    });
  }

  generate(params: { name: CookieName; value: string; expires: Date }) {
    return {
      name: params.name,
      value: params.value,
      options: {
        ...this.defaultCookieOptions(),
        expires: params.expires,
      },
    };
  }

  set(response: Response, cookie: { name: string; value: string; options: CookieOptions }) {
    response.cookie(cookie.name, cookie.value, cookie.options);
  }

  clear(response: Response, cookieName: CookieName) {
    response.clearCookie(cookieName, this.defaultCookieOptions());
  }

  defaultCookieOptions(): CookieOptions {
    const frontendUrl = this.config.getOrThrow<string>("framework.app.frontendUrl");

    return {
      httpOnly: true,
      sameSite: "strict",
      secure: frontendUrl.startsWith("https") ? true : false,
    };
  }
}
