import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EvaluationRun, EvaluationRunStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

import { EvaluationProviderRegistry } from "./evaluation-provider.registry";
import { EvaluationSubjectRef } from "./ports/evaluation.contracts";
import { toSubjectRef } from "./evaluation-subject.service";

/**
 * A run whose row has not moved for this long is treated as dead. Longer than
 * any judgment budget, so an active row past this means the process died
 * mid-run — keeping it would wedge the partial unique index and block every
 * later run for the same subject and version.
 */
const STALE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Failure text is stored for the caller, not for a bug report: cap it. */
const MAX_ERROR_LENGTH = 1000;

const ACTIVE_STATUSES: EvaluationRunStatus[] = [EvaluationRunStatus.QUEUED, EvaluationRunStatus.RUNNING];

export interface StartEvaluationRunInput {
  subjectId: string;
  /** Omit to let the feature's CriteriaProvider pick the applicable version. */
  criteriaVersionId?: string;
  requestedByRef?: string;
}

export interface ListEvaluationRunsInput {
  subjectId: string;
  criteriaVersionId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationRunService — the run state machine (ADR-020 D1, D5.4).
 *
 * Concurrency is delegated to the database: the partial unique index on
 * (subjectId, criteriaVersionId) covering the active statuses means a second
 * concurrent request fails at insert on any replica, not just within the
 * process that received it.
 */
@Injectable()
export class EvaluationRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: EvaluationProviderRegistry,
  ) {}

  /**
   * Open a run against a published criteria version. Rejects with 409 when an
   * active run already exists for the same subject and version — that is the
   * database saying so, not a cached flag.
   */
  async startRun(input: StartEvaluationRunInput): Promise<EvaluationRun> {
    const subject = await this.prisma.evaluationSubject.findUnique({ where: { id: input.subjectId } });
    if (!subject) throw new NotFoundException(`Evaluation subject ${input.subjectId} not found`);

    const criteriaVersionId = input.criteriaVersionId ?? (await this.resolveVersionId(toSubjectRef(subject)));
    const version = await this.requirePublishedVersion(criteriaVersionId);
    if (version.kind !== subject.kind) {
      throw new BadRequestException(
        `Criteria version ${version.family}/${version.version} judges kind "${version.kind}", not "${subject.kind}"`,
      );
    }

    await this.expireStaleRuns(input.subjectId, criteriaVersionId);
    try {
      return await this.prisma.evaluationRun.create({
        data: {
          subjectId: input.subjectId,
          criteriaVersionId,
          requestedByRef: input.requestedByRef,
          status: EvaluationRunStatus.QUEUED,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `An evaluation is already running for subject ${input.subjectId} against criteria version ${criteriaVersionId}.`,
        );
      }
      throw error;
    }
  }

  /** QUEUED → RUNNING. Records the start timestamp used as the finding cutoff. */
  async markRunning(id: string): Promise<void> {
    await this.prisma.evaluationRun.updateMany({
      where: { id, status: EvaluationRunStatus.QUEUED },
      data: { status: EvaluationRunStatus.RUNNING, startedAt: new Date() },
    });
  }

  /** Terminal success. The result row is written before this is called. */
  async markSucceeded(id: string): Promise<void> {
    await this.prisma.evaluationRun.updateMany({
      where: { id, status: { in: ACTIVE_STATUSES } },
      data: { status: EvaluationRunStatus.SUCCEEDED, finishedAt: new Date() },
    });
  }

  /** Terminal failure; the reason is what the caller sees in the run history. */
  async markFailed(id: string, error: unknown): Promise<void> {
    await this.prisma.evaluationRun.updateMany({
      where: { id, status: { in: ACTIVE_STATUSES } },
      data: {
        status: EvaluationRunStatus.FAILED,
        error: describeError(error).slice(0, MAX_ERROR_LENGTH),
        finishedAt: new Date(),
      },
    });
  }

  async findById(id: string): Promise<EvaluationRun> {
    const run = await this.prisma.evaluationRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Evaluation run ${id} not found`);
    return run;
  }

  async listRuns(query: ListEvaluationRunsInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationRun,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          subjectId: query.subjectId,
          ...(query.criteriaVersionId ? { criteriaVersionId: query.criteriaVersionId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      },
    });
  }

  /** Ask the feature which version applies, then resolve the published row. */
  private async resolveVersionId(subject: EvaluationSubjectRef): Promise<string> {
    const selection = await this.providers.getCriteriaProvider(subject.kind).selectVersion(subject);
    if (!selection) {
      throw new ConflictException(
        `No criteria version is applicable to subject ${subject.id} (kind "${subject.kind}")`,
      );
    }
    const version = await this.prisma.evaluationCriteriaVersion.findFirst({
      where: { kind: subject.kind, family: selection.family, version: selection.version, publishedAt: { not: null } },
    });
    if (!version) {
      throw new NotFoundException(
        `Criteria version ${selection.family}/${selection.version} is not published for kind "${subject.kind}"`,
      );
    }
    return version.id;
  }

  private async requirePublishedVersion(id: string) {
    const version = await this.prisma.evaluationCriteriaVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException(`Evaluation criteria version ${id} not found`);
    if (!version.publishedAt) {
      throw new ConflictException(`Evaluation criteria version ${id} is a draft and cannot be run against`);
    }
    return version;
  }

  /** Flip abandoned active rows to FAILED so they stop blocking new runs. */
  private async expireStaleRuns(subjectId: string, criteriaVersionId: string): Promise<void> {
    await this.prisma.evaluationRun.updateMany({
      where: {
        subjectId,
        criteriaVersionId,
        status: { in: ACTIVE_STATUSES },
        updatedAt: { lt: new Date(Date.now() - STALE_RUN_TIMEOUT_MS) },
      },
      data: {
        status: EvaluationRunStatus.FAILED,
        error: "Run abandoned: no progress within the timeout window (process restart?)",
        finishedAt: new Date(),
      },
    });
  }
}

/**
 * Prisma surfaces a unique-index conflict as P2002. The index here is declared
 * in consumer migration SQL rather than the schema, so the message is checked
 * as well — a conflict must never be reported as a generic 500.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === "P2002") return true;
  return typeof message === "string" && message.includes("EvaluationRun_one_active_per_subject_version");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
