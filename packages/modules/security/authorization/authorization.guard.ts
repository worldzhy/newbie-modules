import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSION_KEY } from "./require-permission.decorator";
import { AccessTokenParsed } from "../security.interface";
import {
  PERMISSION_AUTHORIZER,
  PermissionAuthorizer,
  PermissionRequirement,
  Scope,
} from "../ports/permission.authorizer";
import {
  SCOPE_RESOLVERS,
  HOST_SCOPED_RESOURCES,
  ScopeResolver,
  defaultProjectScopeResolver,
} from "../ports/scope.resolver";

interface PermissionMetadata extends PermissionRequirement {
  scope?: string;
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissionAuthorizer?: PermissionAuthorizer,
    @Optional()
    @Inject(SCOPE_RESOLVERS)
    private readonly scopeResolvers?: Record<string, ScopeResolver>,
    @Optional()
    @Inject(HOST_SCOPED_RESOURCES)
    private readonly hostScopedResources?: string[],
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

    // [step 2] Read the identity established by AuthenticationGuard. Verifying
    // the token again here would duplicate revocation/session logic and would
    // reject non-Bearer strategies before they are even considered.
    const req = context.switchToHttp().getRequest<{
      user?: AccessTokenParsed;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();
    const currentUser = req.user;
    if (!currentUser) {
      throw new UnauthorizedException("Authentication is required.");
    }

    // [step 3] Delegate the permission decision to the identity provider.
    if (!this.permissionAuthorizer) {
      throw new InternalServerErrorException(
        "A route requires permission but no PERMISSION_AUTHORIZER is bound. Did the identity provider module load?",
      );
    }

    // [step 4] Resolve scope — dual-track during migration.
    let scope: Scope | undefined;
    const { resource, action } = metadata;

    if (metadata.scope === "self") {
      // Explicit opt-out: the handler scopes the data by the caller's own
      // identity (e.g. "my monitoring systems"), so authorization is atom-only.
      return this.permissionAuthorizer.authorize(currentUser.userId, { resource, action });
    }

    if (metadata.scope) {
      // Legacy track: decorator carries resolver key directly.
      const resolver =
        this.scopeResolvers?.[metadata.scope] ??
        (metadata.scope === "project" ? defaultProjectScopeResolver : undefined);
      if (!resolver) {
        throw new InternalServerErrorException(`Scope resolver "${metadata.scope}" is not registered.`);
      }
      scope = await resolver.resolve(context);
    } else if (this.hostScopedResources?.includes(resource)) {
      // New track: host declares the resource is scope-sensitive. Only
      // resolvers whose declared request key is actually present run, all
      // present keys must agree on one project, and no key at all means deny.
      const resolved = await this.resolveHostScope(context, req);
      if (resolved === null) {
        return false;
      }
      scope = resolved;
    }

    return this.permissionAuthorizer.authorize(currentUser.userId, { resource, action }, scope);
  }

  /**
   * Fail-closed resolution: a scope-sensitive resource is never downgraded to a
   * system-level check because a resolver happened to return `none`, and an
   * ambiguous request (two identifier params naming different projects) is
   * denied rather than silently trusting resolver registration order.
   */
  private async resolveHostScope(context: ExecutionContext, req: RequestShape): Promise<Scope | null> {
    const resolvers = Object.values(this.scopeResolvers ?? {}).filter((resolver) =>
      hasKey(req, resolver.param),
    );
    if (resolvers.length === 0) {
      return null;
    }

    const resolved = await Promise.all(resolvers.map((resolver) => resolver.resolve(context)));
    const candidates = resolved.filter((scope): scope is { type: "project"; id: string } => scope.type !== "none");
    if (candidates.length === 0) {
      return null;
    }

    const projectIds = new Set(candidates.map((scope) => scope.id));
    if (projectIds.size !== 1) {
      return null;
    }

    return candidates[0];
  }
}

interface RequestShape {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

function hasKey(req: RequestShape, key: string): boolean {
  return (
    typeof req.params?.[key] === "string" ||
    typeof req.query?.[key] === "string" ||
    typeof req.body?.[key] === "string"
  );
}
