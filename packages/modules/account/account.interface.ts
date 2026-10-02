import type { Request as NestRequest } from "@nestjs/common";
import { MfaMethod, UserRole } from "@generated/prisma/client";
import type { Request as ExpressRequest } from "express";

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

/**
 * The single authenticated identity shape attached to `request.user` by
 * every authenticated passport strategy (JWT, password login,
 * verification-code login). Login strategies only know { userId }; the JWT
 * strategy additionally resolves the live session and its roles.
 */
export interface AccessTokenParsed {
  userId: string;
  sessionId?: number;
  roles?: UserRole[];
}

type CombinedRequest = ExpressRequest & typeof NestRequest;
export interface UserRequest extends CombinedRequest {
  user: AccessTokenParsed;
}
