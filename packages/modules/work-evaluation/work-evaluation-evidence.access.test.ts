import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import type { PermissionAuthorizer, PermissionRequirement } from "@modules/security/ports/permission.authorizer";
import type { UserRequest } from "@modules/security/security.interface";

import { WorkEvaluationEvidenceController } from "./controllers/evidence.controller";
import { WorkEvaluationEvidenceService } from "./work-evaluation-evidence.service";

/**
 * Evidence read authorization (ADR-024): a caller always reads their own
 * evidence; another member's evidence is readable only with the manager
 * permission on the model, and the document read stays inside the resolved
 * evaluatee's rows.
 */
const CALLER = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ID = "33333333-3333-4333-8333-333333333333";

interface Call {
  method: string;
  args: unknown[];
}

function buildController(options: { allowed: boolean }) {
  const calls: Call[] = [];
  const requirementCalls: PermissionRequirement[] = [];

  const evidence = {
    listWorkspaces: async (...args: unknown[]) => {
      calls.push({ method: "listWorkspaces", args });
      return [];
    },
    listSessions: async (...args: unknown[]) => {
      calls.push({ method: "listSessions", args });
      return {};
    },
    listDocuments: async (...args: unknown[]) => {
      calls.push({ method: "listDocuments", args });
      return {};
    },
    getDocument: async (...args: unknown[]) => {
      calls.push({ method: "getDocument", args });
      return {};
    },
  };
  const authorizer: PermissionAuthorizer = {
    authorize: async (_userId: string, requirement: PermissionRequirement) => {
      requirementCalls.push(requirement);
      return options.allowed;
    },
  };

  const controller = new WorkEvaluationEvidenceController(
    evidence as unknown as WorkEvaluationEvidenceService,
    {} as never,
    {} as never,
    authorizer,
  );
  return { controller, calls, requirementCalls };
}

function request(userId: string): UserRequest {
  return { user: { userId } } as UserRequest;
}

describe("work-evaluation evidence reads", () => {
  it("defaults to the caller's own evidence without asking for a manager permission", async () => {
    const { controller, calls, requirementCalls } = buildController({ allowed: false });

    await controller.listDocuments(request(CALLER), {});

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[0], { evaluateeUserId: CALLER });
    assert.equal(requirementCalls.length, 0);
  });

  it("rejects a cross-member list when the caller holds no manager permission", async () => {
    const { controller } = buildController({ allowed: false });

    await assert.rejects(
      controller.listSessions(request(CALLER), { evaluateeUserId: OTHER_MEMBER }),
      ForbiddenException,
    );
  });

  it("allows a cross-member list with the manager permission on the model", async () => {
    const { controller, calls, requirementCalls } = buildController({ allowed: true });

    await controller.listWorkspaces(request(CALLER), { evaluateeUserId: OTHER_MEMBER });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[0], { evaluateeUserId: OTHER_MEMBER });
    assert.deepEqual(requirementCalls, [
      { resource: Prisma.ModelName.WorkEvaluationWorkspace, action: PermissionAction.List },
    ]);
  });

  it("binds a document read to the resolved evaluatee", async () => {
    const { controller, calls } = buildController({ allowed: true });

    await controller.getDocument({ id: DOCUMENT_ID }, { evaluateeUserId: OTHER_MEMBER }, request(CALLER));

    assert.deepEqual(calls[0].args, [DOCUMENT_ID, OTHER_MEMBER]);
  });

  it("binds a self document read to the caller and never asks for a manager permission", async () => {
    const { controller, calls, requirementCalls } = buildController({ allowed: false });

    await controller.getDocument({ id: DOCUMENT_ID }, {}, request(CALLER));

    assert.deepEqual(calls[0].args, [DOCUMENT_ID, CALLER]);
    assert.equal(requirementCalls.length, 0);
  });
});

describe("work-evaluation evidence service fail-closed reads", () => {
  it("rejects a list without an evaluatee id instead of widening to every member", async () => {
    const service = new WorkEvaluationEvidenceService({} as never);

    await assert.rejects(service.listDocuments({}), BadRequestException);
    await assert.rejects(service.listSessions({}), BadRequestException);
    await assert.rejects(service.listWorkspaces({}), BadRequestException);
  });
});
