import type {Request as NestRequest} from '@nestjs/common';
import {MfaMethod} from '@generated/prisma/client';
import type {Request as ExpressRequest} from 'express';

export enum AccessTokenType {
  user = 'user',
  apiKey = 'api-key',
}

export interface AccessTokenClaims {
  userId: string;
  sessionId: number;
  role?: string;
}

export interface AccessTokenParsed {
  /** 'userId' or 'apiKeyId depends on the type */
  userId: string;
  sessionId?: number;
  role?: string;
  type: AccessTokenType;
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

export interface MfaTokenPayload {
  userId: string;
  type: MfaMethod;
}

type CombinedRequest = ExpressRequest & typeof NestRequest;
export interface UserRequest extends CombinedRequest {
  user: AccessTokenParsed;
}
