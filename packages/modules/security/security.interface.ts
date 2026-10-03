import type { Request as NestRequest } from "@nestjs/common";
import type { Request as ExpressRequest } from "express";

/**
 * The single authenticated identity shape attached to `request.user` by
 * every authenticated passport strategy (JWT, password login,
 * verification-code login). Login strategies only know { userId }; the JWT
 * strategy additionally resolves the live session and its roles.
 *
 * Roles are modelled as plain strings on purpose: security is a foundation
 * module with no data model of its own. Identity providers (e.g. the account
 * module) supply concrete role values such as "ADMIN".
 */
export interface AccessTokenParsed {
  userId: string;
  sessionId?: number;
  roles?: string[];
}

type CombinedRequest = ExpressRequest & typeof NestRequest;
export interface UserRequest extends CombinedRequest {
  user: AccessTokenParsed;
}
