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

export interface MfaTokenPayload {
  userId: string;
  type: MfaMethod;
}
