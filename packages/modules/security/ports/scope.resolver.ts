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
 *    HOST_SCOPED_RESOURCES; the Guard runs every resolver whose declared key is
 *    present in the request and requires a single, unambiguous project. No
 *    matching key at all denies the request (fail closed).
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
 * metadata carries no legacy `scope` key, it runs every registered
 * ScopeResolver whose declared request key is present, and accepts the result
 * only when exactly one project is named. Absent keys (or conflicting projects)
 * deny the request.
 *
 * Type is flat string[] (resource names); resolver selection is by `param`, not
 * by registration order.
 */
export const HOST_SCOPED_RESOURCES = Symbol("HOST_SCOPED_RESOURCES");

export interface ScopeResolver {
  /**
   * Request key owned by this resolver: read from route params, then query,
   * then body. The Guard only invokes resolvers whose key is present, so
   * unrelated resolvers never run and registration order cannot decide the
   * authorization scope.
   */
  param: string;
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
  param: "projectId",
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
