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
  // Nonce echoed in the final redirect's URL hash and verified by the frontend
  // landing page, binding the handed-over session to this browser.
  OAUTH_CALLBACK_PROOF = "oauthCallbackProof",
  // Post-login destination carried across the OAuth handshake.
  OAUTH_REDIRECT_URL = "oauthRedirectUrl",
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

  /**
   * Build the proof cookie for the last hop of an OAuth handshake. The callback
   * mints a random value, stores it here and echoes it in the redirect hash; the
   * frontend adopts the session only when the two match. A callback URL replayed
   * from another browser (login CSRF) carries a proof that this browser never
   * received. The cookie must be readable by the frontend, so it is not
   * httpOnly; the value is single-use and grants nothing by itself.
   */
  generateForOAuthCallbackProof(proof: string) {
    return {
      name: CookieName.OAUTH_CALLBACK_PROOF,
      value: proof,
      options: {
        ...this.defaultCookieOptions(),
        httpOnly: false,
        sameSite: "lax" as const,
        maxAge: 10 * 60 * 1000,
      },
    };
  }

  /** Build the cookie holding where to send the user after a successful login. */
  generateForOAuthRedirect(redirectUrl: string) {
    return {
      name: CookieName.OAUTH_REDIRECT_URL,
      value: redirectUrl,
      options: {
        ...this.defaultCookieOptions(),
        sameSite: "lax" as const,
        maxAge: 10 * 60 * 1000,
      },
    };
  }

  /** Expire a single-use OAuth cookie once it has been consumed. */
  clearOAuthCookie(name: CookieName, response: Response) {
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
