import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRequest } from "../security.interface";

export const OAUTH_SCOPE_KEY = "oauth-scope";

/**
 * Marks a route as requiring an OAuth scope.
 *
 * Web-UI sessions (oauthScope === null) always pass: this guard only restricts
 * sessions minted by the OAuth authorize flow. When the caller is an OAuth
 * client, the granted scope string must include every listed scope token.
 *
 * Scope tokens are space-separated in the grant (RFC 6749 §3.3). A route that
 * declares @RequireScope("resource:read") passes when oauthScope contains
 * "resource:read" anywhere in its token list.
 */
export const RequireScope = (...scopes: string[]) => SetMetadata(OAUTH_SCOPE_KEY, scopes);

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string[]>(OAUTH_SCOPE_KEY, context.getHandler());
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<UserRequest>();
    const user = req.user;

    // Web-UI sessions carry oauthScope === null. They are not OAuth clients,
    // so the OAuth scope restriction does not apply.
    if (user.oauthScope === null || user.oauthScope === undefined) {
      return true;
    }

    const granted = new Set(user.oauthScope.split(/\s+/).filter(Boolean));
    const missing = required.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      throw new ForbiddenException(`OAuth scope missing: ${missing.join(", ")}`);
    }
    return true;
  }
}
