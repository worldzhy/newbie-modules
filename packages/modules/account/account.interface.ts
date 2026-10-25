import { MfaMethod } from "@generated/prisma/client";

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TotpTokenResponse {
  totpToken: string;
  type: MfaMethod;
  multiFactorRequired: true;
}

export interface LoginSessionResponse {
  token: string;
  tokenExpiresInSeconds: number;
}

/**
 * Result of a login attempt: either a completed session, or an MFA challenge
 * the client must finish at /auth/login-by-totp before any session exists.
 */
export type LoginResult = LoginSessionResponse | TotpTokenResponse;

/**
 * Outcome of the shared session-issuance exit (AuthService.issueLoginSession):
 * either an MFA challenge, or the freshly minted credentials. Channels choose
 * which fields to expose publicly — browser channels carry the refresh token
 * in an httpOnly cookie, while the WeChat mini-program (no cookie jar)
 * receives it in the response body.
 */
export type IssuedLoginSession =
  { mfaChallenge: TotpTokenResponse } | { token: string; refreshToken: string; tokenExpiresInSeconds: number };

export interface MfaTokenPayload {
  userId: string;
  type: MfaMethod;
}
