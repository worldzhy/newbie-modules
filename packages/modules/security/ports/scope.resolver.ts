import { ExecutionContext } from "@nestjs/common";
import { Scope } from "./permission.authorizer";

/**
 * SPI port for resolving an authorization scope from the request context.
 *
 * Hosts register resolvers by key (e.g. "project", "application") via the
 * SCOPE_RESOLVERS token. The `@RequirePermission` decorator references a
 * resolver key; the AuthorizationGuard looks up the resolver and calls it
 * to obtain the Scope passed to PermissionAuthorizer.
 *
 * The default "project" resolver extracts `request.params.projectId`. Hosts
 * may override it or register additional resolvers for sub-resources (e.g.
 * resolving an applicationId back to its projectId).
 */
export const SCOPE_RESOLVERS = Symbol("SCOPE_RESOLVERS");

export interface ScopeResolver {
  resolve(context: ExecutionContext): Promise<Scope>;
}

/** Default resolver: reads projectId from route params. */
export const defaultProjectScopeResolver: ScopeResolver = {
  resolve: async (context) => {
    const req = context.switchToHttp().getRequest<{ params: Record<string, string> }>();
    const projectId = req.params?.projectId;
    if (!projectId) {
      return { type: "none" };
    }
    return { type: "project", id: projectId };
  },
};
