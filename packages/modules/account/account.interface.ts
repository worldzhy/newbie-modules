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

export interface MfaTokenPayload {
  userId: string;
  type: MfaMethod;
}
