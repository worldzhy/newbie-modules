import { ExecutionContext } from "@nestjs/common";
import { Scope } from "./permission.authorizer";

export { Scope };

/**
 * SPI port for resolving an authorization scope from the request context.
 *
 * Hosts register resolvers by key (e.g. "project", "application") via the
 * SCOPE_RESOLVERS token. The `@RequirePermission` decorator references a
 * resolver key; the AuthorizationGuard looks up the resolver and calls it
 * to obtain the Scope passed to PermissionAuthorizer.
 *
 * The default "project" resolver extracts `projectId` from route params, then
 * query, then body — in that order. Hosts may override it or register
 * additional resolvers for sub-resources (e.g. resolving an applicationId
 * back to its projectId).
 */
export const SCOPE_RESOLVERS = Symbol("SCOPE_RESOLVERS");

export interface ScopeResolver {
  resolve(context: ExecutionContext): Promise<Scope>;
}

/**
 * Default resolver: reads projectId from route params, falling back to query
 * and then body. Many resource controllers take projectId as a filter query
 * (e.g. `GET /ec2-instances?projectId=...`) or in the mutation body; the
 * declared permission is then checked against that claimed project. Routes
 * whose projectId lives elsewhere must register a dedicated resolver.
 */
export const defaultProjectScopeResolver: ScopeResolver = {
  resolve: async (context) => {
    const req = context.switchToHttp().getRequest<{
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();
    const candidate = req.params?.projectId ?? req.query?.projectId ?? req.body?.projectId;
    if (typeof candidate !== "string" || !candidate) {
      return { type: "none" };
    }
    return { type: "project", id: candidate };
  },
};
