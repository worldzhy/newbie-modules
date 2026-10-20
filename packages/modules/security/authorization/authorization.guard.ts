import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSION_KEY } from "./require-permission.decorator";
import { TokenService } from "../token/token.service";
import {
  PERMISSION_AUTHORIZER,
  PermissionAuthorizer,
  PermissionRequirement,
  Scope,
} from "../ports/permission.authorizer";
import { SCOPE_RESOLVERS, ScopeResolver, defaultProjectScopeResolver } from "../ports/scope.resolver";

interface PermissionMetadata extends PermissionRequirement {
  scope?: string;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly tokenService: TokenService,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissionAuthorizer?: PermissionAuthorizer,
    @Optional()
    @Inject(SCOPE_RESOLVERS)
    private readonly scopeResolvers?: Record<string, ScopeResolver>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // [step 1] Get required permission.
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!metadata) {
      return true;
    }

    // [step 2] Parse JWT.
    const req = context.switchToHttp().getRequest();
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);
    if (accessToken === undefined) {
      return false;
    }
    const payload = this.tokenService.verifyUserAccessToken(accessToken);

    // [step 3] Delegate the permission decision to the identity provider.
    if (!this.permissionAuthorizer) {
      throw new InternalServerErrorException(
        "A route requires permission but no PERMISSION_AUTHORIZER is bound. Did the identity provider module load?",
      );
    }

    // [step 4] Resolve scope if declared.
    let scope: Scope | undefined;
    if (metadata.scope) {
      const resolver =
        this.scopeResolvers?.[metadata.scope] ??
        (metadata.scope === "project" ? defaultProjectScopeResolver : undefined);
      if (!resolver) {
        throw new InternalServerErrorException(`Scope resolver "${metadata.scope}" is not registered.`);
      }
      scope = await resolver.resolve(context);
    }

    const { resource, action } = metadata;
    return this.permissionAuthorizer.authorize(payload.userId, { resource, action }, scope);
  }
}
