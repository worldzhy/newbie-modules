import { ExecutionContext } from "@nestjs/common";
import { Scope } from "./permission.authorizer";

export { Scope };

/**
 * SPI port for resolving an authorization scope from the request context.
 *
 * Hosts register resolvers by key (e.g. "project", "application") via the
 * SCOPE_RESOLVERS token. Two ways a resolver gets selected:
 *
 * 1. Preferred (ADR-017): the resource is listed in the host's
 *    HOST_SCOPED_RESOURCES; the Guard iterates resolvers in registration order
 *    and takes the first non-{type:"none"} result.
 * 2. Legacy: a `@RequirePermission` decorator still carries
 *    `{ scope: "<key>" }`; the Guard looks that key up directly. Deprecated for
 *    modules — decorators must not name host vocabulary.
 *
 * The default "project" resolver extracts `projectId` from route params, then
 * query, then body — in that order. Hosts may override it or register
 * additional resolvers for sub-resources (e.g. resolving an applicationId
 * back to its projectId).
 */
export const SCOPE_RESOLVERS = Symbol("SCOPE_RESOLVERS");

/**
 * SPI port that hosts bind to declare which resources need scope resolution.
 *
 * When the AuthorizationGuard sees a resource in this list and the route
 * metadata carries no legacy `scope` key, it iterates all registered
 * ScopeResolvers in SCOPE_RESOLVERS priority order — the first one that
 * returns a non-{type:"none"} Scope wins.
 *
 * Type is flat string[] (resource names). The host controls resolver
 * priority via the key insertion order in SCOPE_RESOLVERS (specific
 * resolvers first, defaultProjectScopeResolver last).
 */
export const HOST_SCOPED_RESOURCES = Symbol("HOST_SCOPED_RESOURCES");

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
