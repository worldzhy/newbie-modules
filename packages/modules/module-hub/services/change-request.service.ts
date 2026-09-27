import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { CreateHubChangeRequestDto, HubAgentResultDto, ListHubChangeRequestsQueryDto } from "../module-hub.dto";
import { ModuleHubInstallationService } from "./installation.service";

interface ChangePayload {
  moduleKey: string;
  targetSourceCommit?: string;
  options: { driftPolicy: "reject" | "force"; delivery: "worktree" | "pr" };
}

/**
 * Change-request lifecycle: the host creates PENDING orders (creation IS the
 * approval decision), the agent claims them atomically on poll and reports
 * receipts on a later poll. No retry/cancel in v1 — retry = create a new one.
 */
@Injectable()
export class ModuleHubChangeRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: ModuleHubInstallationService,
  ) {}

  async create(installationId: string, dto: CreateHubChangeRequestDto) {
    await this.installations.getOrThrow(installationId);
    const payload: ChangePayload = {
      moduleKey: dto.moduleKey,
      ...(dto.targetSourceCommit ? { targetSourceCommit: dto.targetSourceCommit } : {}),
      options: {
        driftPolicy: dto.driftPolicy ?? "reject",
        delivery: dto.delivery ?? "worktree",
      },
    };
    const row = await this.prisma.hubChangeRequest.create({
      data: {
        installationId,
        type: dto.type as any,
        payload: payload as any,
        createdBy: dto.createdBy ?? null,
      },
    });
    await this.installations.audit(installationId, "change.create", `host:${dto.createdBy ?? "unknown"}`, {
      changeRequestId: row.id,
      type: dto.type,
      moduleKey: dto.moduleKey,
    });
    return row;
  }

  async list(installationId: string, query: ListHubChangeRequestsQueryDto) {
    await this.installations.getOrThrow(installationId);
    return this.prisma.hubChangeRequest.findMany({
      where: { installationId, ...(query.status ? { status: query.status as any } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Atomically flip this installation's PENDING requests to RUNNING (oldest
   * first) and return them in the agent-facing shape. The pickedAt marker
   * makes the claim race-safe: only rows flipped by THIS call carry it.
   */
  async claimPending(installationId: string) {
    const pickedAt = new Date();
    await this.prisma.hubChangeRequest.updateMany({
      where: { installationId, status: "PENDING" },
      data: { status: "RUNNING", pickedAt },
    });
    const claimed = await this.prisma.hubChangeRequest.findMany({
      where: { installationId, status: "RUNNING", pickedAt },
      orderBy: { createdAt: "asc" },
    });
    for (const row of claimed) {
      await this.installations.audit(installationId, "change.pick", `agent:${installationId}`, {
        changeRequestId: row.id,
        type: row.type,
      });
    }
    return claimed.map((row) => {
      const payload = row.payload as ChangePayload;
      return {
        id: row.id,
        type: row.type as "ADD" | "REMOVE" | "UPGRADE",
        moduleKey: payload.moduleKey,
        targetSourceCommit: payload.targetSourceCommit,
        driftPolicy: payload.options.driftPolicy,
        delivery: payload.options.delivery,
      };
    });
  }

  /**
   * Apply execution receipts. Only RUNNING requests owned by this installation
   * are accepted; anything else is skipped (stale/foreign receipt).
   */
  async processResults(installationId: string, results: HubAgentResultDto[]) {
    let applied = 0;
    for (const result of results) {
      const row = await this.prisma.hubChangeRequest.findFirst({
        where: { id: result.changeRequestId, installationId, status: "RUNNING" },
      });
      if (!row) continue;
      await this.prisma.hubChangeRequest.update({
        where: { id: row.id },
        data: {
          status: result.outcome as any,
          resultSummary: (result.summary ?? undefined) as any,
          errorReason: result.error ?? null,
          finishedAt: new Date(),
        },
      });
      await this.installations.audit(
        installationId,
        result.outcome === "DONE" ? "change.done" : "change.fail",
        `agent:${installationId}`,
        { changeRequestId: row.id, error: result.error ?? null },
      );
      applied += 1;
    }
    return { applied };
  }
}
