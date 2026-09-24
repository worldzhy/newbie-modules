import type {Request as NestRequest} from '@nestjs/common';
import {UserRole} from '@prisma/client';
import type {Request as ExpressRequest} from 'express';

export type MfaMethod = 'NONE' | 'SMS' | 'TOTP' | 'EMAIL';

export interface AccessTokenClaims {
  id: number;
  scopes: string[];
  sessionId: number;
  role?: UserRole;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface TotpTokenResponse {
  totpToken: string;
  type: MfaMethod;
  multiFactorRequired: true;
}

export enum AccessTokenType {
  user = 'user',
  apiKey = 'api-key',
}

export interface AccessTokenParsed {
  /** 'userId' or 'apiKeyId depends on the type */
  id: number;
  userId?: number;
  teamId?: number;
  scopes: string[];
  type: AccessTokenType;
  sessionId?: number;
  role?: UserRole;
}

export interface MfaTokenPayload {
  id: number;
  type: MfaMethod;
}

type CombinedRequest = ExpressRequest & typeof NestRequest;
export interface UserRequest extends CombinedRequest {
  user: AccessTokenParsed;
}
