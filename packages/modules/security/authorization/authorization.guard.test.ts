/**
 * AuthorizationGuard scope-resolution tests (newbie-modules ADR-017).
 *
 * Pins the new host-configured track: for a resource listed in
 * HOST_SCOPED_RESOURCES, resolvers run in registration order and the first
 * non-{type:"none"} result wins. Also pins that unlisted resources stay
 * system-level and that the legacy decorator `scope` key still short-circuits
 * the iteration.
 *
 * Lives in the consumer because the registry ships no test runner; the guard
 * body is identical to the registry copy (see ADR-017 §影响).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { AuthorizationGuard } from "./authorization.guard";
import { PERMISSION_KEY } from "./require-permission.decorator";
import { defaultProjectScopeResolver } from "../ports/scope.resolver";
import type { Scope, ScopeResolver } from "../ports/scope.resolver";
import type { PermissionAuthorizer, PermissionRequirement } from "../ports/permission.authorizer";
import type { TokenService } from "../token/token.service";

interface Harness {
  guard: AuthorizationGuard;
  context: ExecutionContext;
  authorizeCalls: Array<{ requirement: PermissionRequirement; scope?: Scope }>;
  resolverCalls: string[];
}

function makeGuard(
  metadata: { resource: string; action: string; scope?: string } | undefined,
  resolvers: Record<string, ScopeResolver>,
  hostScopedResources: string[],
  request: Record<string, unknown> = {},
): Harness {
  const authorizeCalls: Harness["authorizeCalls"] = [];
  const resolverCalls: string[] = [];

  const reflector = {
    getAllAndOverride: (key: string) => (key === PERMISSION_KEY ? metadata : undefined),
  } as unknown as Reflector;

  const tokenService = {
    getTokenFromHttpRequest: () => "token",
    verifyUserAccessToken: () => ({ userId: "user-1" }),
  } as unknown as TokenService;

  const authorizer: PermissionAuthorizer = {
    authorize: async (_userId, requirement, scope) => {
      authorizeCalls.push({ requirement, scope });
      return true;
    },
  };

  // Wrap each resolver so call order is observable.
  const tracedResolvers: Record<string, ScopeResolver> = {};
  for (const [name, resolver] of Object.entries(resolvers)) {
    tracedResolvers[name] = {
      resolve: async (ctx) => {
        resolverCalls.push(name);
        return resolver.resolve(ctx);
      },
    };
  }

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const guard = new AuthorizationGuard(reflector, tokenService, authorizer, tracedResolvers, hostScopedResources);

  return { guard, context, authorizeCalls, resolverCalls };
}

const projectResolver = (id: string): ScopeResolver => ({ resolve: async () => ({ type: "project", id }) });
const noneResolver: ScopeResolver = { resolve: async () => ({ type: "none" }) };

describe("AuthorizationGuard scope resolution", () => {
  it("takes the first non-none resolver in registration order and stops", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "Task", action: "Update" },
      { task: noneResolver, "task-space": projectResolver("p-1"), project: projectResolver("p-2") },
      ["Task"],
    );

    assert.strictEqual(await guard.canActivate(context), true);
    assert.deepStrictEqual(resolverCalls, ["task", "task-space"], "iteration must stop at the first hit");
    assert.deepStrictEqual(authorizeCalls[0].scope, { type: "project", id: "p-1" });
  });

  it("leaves scope undefined when every resolver returns none", async () => {
    const { guard, context, authorizeCalls } = makeGuard(
      { resource: "Task", action: "List" },
      { task: noneResolver, project: noneResolver },
      ["Task"],
    );

    await guard.canActivate(context);
    assert.strictEqual(authorizeCalls[0].scope, undefined);
  });

  it("does not resolve scope for resources absent from HOST_SCOPED_RESOURCES", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "LlmConnection", action: "List" },
      { project: projectResolver("p-1") },
      ["Task"],
      { params: { projectId: "p-1" } },
    );

    await guard.canActivate(context);
    assert.deepStrictEqual(resolverCalls, [], "unlisted resource must stay system-level");
    assert.strictEqual(authorizeCalls[0].scope, undefined);
  });

  it("still honours the legacy decorator scope key without iterating", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "Project", action: "Get", scope: "project" },
      { project: defaultProjectScopeResolver },
      [],
      { params: { projectId: "p-legacy" } },
    );

    await guard.canActivate(context);
    assert.deepStrictEqual(resolverCalls, ["project"]);
    assert.deepStrictEqual(authorizeCalls[0].scope, { type: "project", id: "p-legacy" });
  });
});
