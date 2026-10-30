/**
 * AuthorizationGuard scope-resolution tests (newbie-modules ADR-017).
 *
 * Pins the new host-configured track: for a resource listed in
 * HOST_SCOPED_RESOURCES, only resolvers whose declared request key is present
 * run, all present keys must name the same project, and an absent/ambiguous key
 * denies the request (fail closed). Also pins that unlisted resources stay
 * system-level and that the legacy decorator `scope` key still resolves
 * directly.
 *
 * The guard reads the identity established by AuthenticationGuard instead of
 * parsing the JWT itself, so a missing request.user is rejected as
 * unauthenticated (401).
 *
 * Lives in the consumer because the registry ships no test runner; the guard
 * body is identical to the registry copy (see ADR-017 §影响).
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { AuthorizationGuard } from "./authorization.guard";
import { PERMISSION_KEY } from "./require-permission.decorator";
import { defaultProjectScopeResolver } from "../ports/scope.resolver";
import type { Scope, ScopeResolver } from "../ports/scope.resolver";
import type { PermissionAuthorizer, PermissionRequirement } from "../ports/permission.authorizer";

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
      ...resolver,
      resolve: async (ctx) => {
        resolverCalls.push(name);
        return resolver.resolve(ctx);
      },
    };
  }

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: "user-1" }, ...request }) }),
  } as unknown as ExecutionContext;

  const guard = new AuthorizationGuard(reflector, authorizer, tracedResolvers, hostScopedResources);

  return { guard, context, authorizeCalls, resolverCalls };
}

const projectResolver = (id: string): ScopeResolver => ({
  param: "projectId",
  resolve: async () => ({ type: "project", id }),
});
const taskResolver = (id: string): ScopeResolver => ({
  param: "taskId",
  resolve: async () => ({ type: "project", id }),
});
const spaceResolver = (id: string): ScopeResolver => ({
  param: "spaceId",
  resolve: async () => ({ type: "project", id }),
});
const noneTaskResolver: ScopeResolver = { param: "taskId", resolve: async () => ({ type: "none" }) };

describe("AuthorizationGuard scope resolution", () => {
  it("runs only the resolver whose request key is present", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "Task", action: "Update" },
      { task: taskResolver("p-1"), project: projectResolver("p-2") },
      ["Task"],
      { params: { taskId: "t-1" } },
    );

    assert.strictEqual(await guard.canActivate(context), true);
    assert.deepStrictEqual(resolverCalls, ["task"], "unrelated resolvers must not run");
    assert.deepStrictEqual(authorizeCalls[0].scope, { type: "project", id: "p-1" });
  });

  it("reads the key from the body as well as params", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "Task", action: "Create" },
      { "task-space": spaceResolver("p-3") },
      ["Task"],
      { body: { spaceId: "s-1" } },
    );

    assert.strictEqual(await guard.canActivate(context), true);
    assert.deepStrictEqual(resolverCalls, ["task-space"]);
    assert.deepStrictEqual(authorizeCalls[0].scope, { type: "project", id: "p-3" });
  });

  it("denies when no scope key is present", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "Task", action: "List" },
      { task: taskResolver("p-1"), project: projectResolver("p-1") },
      ["Task"],
    );

    assert.strictEqual(await guard.canActivate(context), false, "fail closed: no key means no scope");
    assert.deepStrictEqual(resolverCalls, []);
    assert.deepStrictEqual(authorizeCalls, []);
  });

  it("denies when a present key resolves to none", async () => {
    const { guard, context, authorizeCalls } = makeGuard(
      { resource: "Task", action: "Update" },
      { task: noneTaskResolver },
      ["Task"],
      { params: { taskId: "missing" } },
    );

    assert.strictEqual(await guard.canActivate(context), false);
    assert.deepStrictEqual(authorizeCalls, []);
  });

  it("denies when two present keys name different projects", async () => {
    const { guard, context, resolverCalls } = makeGuard(
      { resource: "Task", action: "Update" },
      { task: taskResolver("p-1"), project: projectResolver("p-2") },
      ["Task"],
      { params: { taskId: "t-1" }, query: { projectId: "p-2" } },
    );

    assert.strictEqual(await guard.canActivate(context), false, "ambiguous scope must not pick a winner");
    assert.deepStrictEqual(resolverCalls, ["task", "project"]);
  });

  it("accepts two present keys that agree on one project", async () => {
    const { guard, context, authorizeCalls } = makeGuard(
      { resource: "Task", action: "Update" },
      { task: taskResolver("p-1"), project: projectResolver("p-1") },
      ["Task"],
      { params: { taskId: "t-1" }, query: { projectId: "p-1" } },
    );

    assert.strictEqual(await guard.canActivate(context), true);
    assert.deepStrictEqual(authorizeCalls[0].scope, { type: "project", id: "p-1" });
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

  it("honours an explicit self scope opt-out without resolving a project", async () => {
    const { guard, context, authorizeCalls, resolverCalls } = makeGuard(
      { resource: "WebMonitorSite", action: "List", scope: "self" },
      { "web-monitor-site": { param: "appId", resolve: async () => ({ type: "project", id: "p-9" }) } },
      ["WebMonitorSite"],
      { params: { appId: "app-1" } },
    );

    assert.strictEqual(await guard.canActivate(context), true);
    assert.deepStrictEqual(resolverCalls, []);
    assert.strictEqual(authorizeCalls[0].scope, undefined);
  });

  it("rejects unauthenticated requests before consulting the authorizer", async () => {
    const { guard, context, authorizeCalls } = makeGuard({ resource: "LlmConnection", action: "List" }, {}, [], {
      user: undefined,
    });

    await assert.rejects(guard.canActivate(context), UnauthorizedException);
    assert.deepStrictEqual(authorizeCalls, []);
  });
});
