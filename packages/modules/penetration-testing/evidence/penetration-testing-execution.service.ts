import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import {
  type PenetrationTestingExecutionOutcome,
  type PenetrationTestingLevel,
} from "../penetration-testing.constants";
import type { PenetrationTestingExecutionSnapshot } from "../ports/penetration-testing.contracts";

export interface RecordPenetrationTestingExecutionInput {
  /** Generated before the run opens and carried in `judgmentConfig.auditId`. */
  auditId: string;
  /** The RUNNING skeleton run this collection belongs to. */
  runId: string;
  subjectId: string;
  level: PenetrationTestingLevel;
  standardKey: string;
  authorizationId: string;
  snapshot: PenetrationTestingExecutionSnapshot;
  startedAt: Date;
}

/**
 * PenetrationTestingExecutionService — the feature's own execution audit row
 * (ADR-075 §3).
 *
 * Written inside `collect`, immediately after the scan or action returns, not at
 * run end: a judgment error or a killed process must not erase the record of
 * what was touched. `finish` is called in the same flow; a killed run gets
 * `outcome = KILLED` here while the skeleton row is recorded as FAILED.
 */
@Injectable()
export class PenetrationTestingExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordPenetrationTestingExecutionInput): Promise<void> {
    await this.prisma.penetrationTestingExecution.upsert({
      where: { auditId: input.auditId },
      create: {
        auditId: input.auditId,
        runId: input.runId,
        subjectId: input.subjectId,
        level: input.level,
        standardKey: input.standardKey,
        authorizationId: input.authorizationId,
        snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
        startedAt: input.startedAt,
        outcome: "FAILED",
      },
      update: {
        snapshot: input.snapshot as unknown as Prisma.InputJsonValue,
        startedAt: input.startedAt,
      },
    });
  }

  async finish(
    auditId: string,
    input: { outcome: PenetrationTestingExecutionOutcome; requestCount: number; finishedAt?: Date },
  ): Promise<void> {
    await this.prisma.penetrationTestingExecution.updateMany({
      where: { auditId },
      data: {
        outcome: input.outcome,
        requestCount: input.requestCount,
        finishedAt: input.finishedAt ?? new Date(),
      },
    });
  }

  /** Link a skeleton run discovered later; normally set at creation. */
  async linkRun(auditId: string, runId: string): Promise<void> {
    await this.prisma.penetrationTestingExecution.updateMany({ where: { auditId }, data: { runId } });
  }

  async markKilled(auditId: string, reason: string): Promise<void> {
    await this.prisma.penetrationTestingExecution.updateMany({
      where: { auditId },
      data: { outcome: "KILLED", killedAt: new Date(), killReason: reason, finishedAt: new Date() },
    });
  }

  async findByAuditId(auditId: string) {
    return this.prisma.penetrationTestingExecution.findUnique({ where: { auditId } });
  }

  async findByRunId(runId: string) {
    return this.prisma.penetrationTestingExecution.findUnique({ where: { runId } });
  }

  async listBySubject(subjectId: string, take = 50) {
    return this.prisma.penetrationTestingExecution.findMany({
      where: { subjectId },
      orderBy: { startedAt: "desc" },
      take,
    });
  }

  /**
   * Generic list with optional filters. Supports pagination via cursor or
   * limit/offset; keeps the newest-first ordering the other list methods use.
   */
  async list(input: {
    subjectId?: string;
    runId?: string;
    level?: PenetrationTestingLevel;
    outcome?: PenetrationTestingExecutionOutcome;
    limit?: number;
    offset?: number;
  }) {
    const where: Prisma.PenetrationTestingExecutionWhereInput = {};
    if (input.subjectId) where.subjectId = input.subjectId;
    if (input.runId) where.runId = input.runId;
    if (input.level) where.level = input.level;
    if (input.outcome) where.outcome = input.outcome;
    const take = Math.min(input.limit ?? 50, 200);
    const skip = input.offset ?? 0;
    const [records, total] = await this.prisma.$transaction([
      this.prisma.penetrationTestingExecution.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take,
        skip,
      }),
      this.prisma.penetrationTestingExecution.count({ where }),
    ]);
    return { records, total, limit: take, offset: skip };
  }
}
