import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationRun, PeopleEvaluationRunStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ListPeopleEvaluationRunsRequestDto } from "./people-evaluation.dto";

/**
 * A run whose row has not moved for this long is treated as dead. The agent has
 * a token budget and a hard timeout well below this, so a row still active after
 * this long means the process died mid-run — keeping it would wedge the partial
 * unique index and block every later run for that member and period.
 */
const STALE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Failure text is stored for the caller, not for a bug report: cap it. */
const MAX_ERROR_LENGTH = 1000;

const ACTIVE_STATUSES: PeopleEvaluationRunStatus[] = [
  PeopleEvaluationRunStatus.QUEUED,
  PeopleEvaluationRunStatus.RUNNING,
];

export interface CreatePeopleEvaluationRunInput {
  evaluateeUserId: string;
  collectionPeriodId: string;
  secondaryModelScope?: string;
}

/**
 * Durable state of on-demand evaluation runs.
 *
 * Concurrency is delegated to the database: the partial unique index on
 * (evaluateeUserId, collectionPeriodId) covering the active statuses means a
 * second concurrent request fails at insert on any replica, not just within the
 * process that received it.
 */
@Injectable()
export class PeopleEvaluationRunService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Open a run. Rejects with 409 when an active run already exists for the same
   * member and period — that is the database saying so, via the partial unique
   * index, not a cached flag.
   */
  async createRun(input: CreatePeopleEvaluationRunInput): Promise<PeopleEvaluationRun> {
    await this.expireStaleRuns(input.evaluateeUserId, input.collectionPeriodId);
    try {
      return await this.prisma.peopleEvaluationRun.create({
        data: {
          evaluateeUserId: input.evaluateeUserId,
          collectionPeriodId: input.collectionPeriodId,
          secondaryModelScope: input.secondaryModelScope,
          status: PeopleEvaluationRunStatus.QUEUED,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `An evaluation is already running for member ${input.evaluateeUserId} in period ${input.collectionPeriodId}.`,
        );
      }
      throw error;
    }
  }

  /** QUEUED → RUNNING. Records the start timestamp for the caller's view. */
  async markRunning(id: string): Promise<void> {
    await this.prisma.peopleEvaluationRun.updateMany({
      where: { id, status: PeopleEvaluationRunStatus.QUEUED },
      data: { status: PeopleEvaluationRunStatus.RUNNING, startedAt: new Date() },
    });
  }

  /** Terminal success; `resultId` points at the archived evaluation result. */
  async markSucceeded(id: string, resultId: string): Promise<void> {
    await this.prisma.peopleEvaluationRun.updateMany({
      where: { id, status: { in: ACTIVE_STATUSES } },
      data: { status: PeopleEvaluationRunStatus.SUCCEEDED, resultId, finishedAt: new Date() },
    });
  }

  /** Terminal failure; the reason is what the caller sees in `GET /:id`. */
  async markFailed(id: string, error: unknown): Promise<void> {
    await this.prisma.peopleEvaluationRun.updateMany({
      where: { id, status: { in: ACTIVE_STATUSES } },
      data: {
        status: PeopleEvaluationRunStatus.FAILED,
        error: describeError(error).slice(0, MAX_ERROR_LENGTH),
        finishedAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<PeopleEvaluationRun> {
    const run = await this.prisma.peopleEvaluationRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Evaluation run ${id} not found`);
    return run;
  }

  /**
   * Run history, newest first. Filtering by member and period is what lets a
   * client that reloaded the page find a still-active run and re-attach to it.
   */
  async listRuns(query: ListPeopleEvaluationRunsRequestDto) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PeopleEvaluationRun,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          evaluateeUserId: query.evaluateeUserId,
          collectionPeriodId: query.collectionPeriodId,
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      },
    });
  }

  /** Flip abandoned active rows to FAILED so they stop blocking new runs. */
  private async expireStaleRuns(evaluateeUserId: string, collectionPeriodId: string): Promise<void> {
    await this.prisma.peopleEvaluationRun.updateMany({
      where: {
        evaluateeUserId,
        collectionPeriodId,
        status: { in: ACTIVE_STATUSES },
        updatedAt: { lt: new Date(Date.now() - STALE_RUN_TIMEOUT_MS) },
      },
      data: {
        status: PeopleEvaluationRunStatus.FAILED,
        error: "Run abandoned: no progress within the timeout window (process restart?)",
        finishedAt: new Date(),
      },
    });
  }
}

/**
 * Prisma surfaces a unique-index conflict as P2002. The index here is declared in
 * raw migration SQL rather than the schema, so the message is checked as well —
 * a conflict must never be reported as a generic 500.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "P2002") return true;
  return typeof message === "string" && message.includes("PeopleEvaluationRun_one_active_per_member_period");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
