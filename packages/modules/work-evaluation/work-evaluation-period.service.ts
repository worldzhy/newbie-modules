import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  WorkEvaluationPeriod,
  WorkEvaluationPeriodStatus,
  WorkEvaluationPeriodType,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { EvaluationCriteriaService } from "@modules/evaluation/evaluation-criteria.service";
import {
  CreateWorkEvaluationPeriodRequestDto,
  ListWorkEvaluationPeriodsRequestDto,
  UpdateWorkEvaluationHomeGroundRequestDto,
} from "./work-evaluation.dto";
import { WORK_EVALUATION_SUBJECT_KIND } from "./work-evaluation.constants";

/**
 * WorkEvaluationPeriodService — evaluation periods and the home-ground
 * declaration (ADR-024). Criteria content itself lives in the evaluation
 * skeleton (ADR-020); a period only pins one published criteria version of
 * kind "work" by scalar id. These are the ex ante anchors: when members are
 * judged, and against which declared specialty circle.
 */
@Injectable()
export class WorkEvaluationPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly criteria: EvaluationCriteriaService,
  ) {}

  // --- Evaluation periods ------------------------------------------------

  async listPeriods(query: ListWorkEvaluationPeriodsRequestDto) {
    const where = query.type ? { type: query.type } : {};
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.WorkEvaluationPeriod,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: { where, orderBy: [{ periodStart: "desc" }, { id: "asc" }] },
    });
  }

  async getPeriodById(id: string): Promise<WorkEvaluationPeriod> {
    const period = await this.prisma.workEvaluationPeriod.findUnique({ where: { id } });
    if (!period) {
      throw new NotFoundException(`Evaluation period ${id} not found`);
    }
    return period;
  }

  async createPeriod(input: CreateWorkEvaluationPeriodRequestDto): Promise<WorkEvaluationPeriod> {
    // The pinned criteria version must exist, judge kind "work", and be
    // published — a period can never anchor on a draft.
    const version = await this.criteria.getVersion(input.ruleSetVersionId);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new BadRequestException(
        `Criteria version ${version.evaluationKey}/${version.version} judges kind "${version.kind}", not "${WORK_EVALUATION_SUBJECT_KIND}"`,
      );
    }
    if (!version.publishedAt) {
      throw new ConflictException(
        `Criteria version ${version.evaluationKey}/${version.version} is a draft and cannot anchor a period`,
      );
    }
    if (input.periodStart.getTime() >= input.periodEnd.getTime()) {
      throw new BadRequestException("periodStart must be before periodEnd");
    }
    // Ex ante anchor: a period cannot start before its criteria were published.
    if (input.periodStart.getTime() < version.publishedAt.getTime()) {
      throw new BadRequestException(
        `Period cannot start before criteria version ${version.evaluationKey}/${version.version} was published at ${version.publishedAt.toISOString()}`,
      );
    }

    const overlappingWhere = {
      type: input.type,
      periodStart: { lt: input.periodEnd },
      periodEnd: { gt: input.periodStart },
    };
    // The overlap check and the insert must be atomic: a serializable
    // transaction makes two concurrent creators of overlapping periods fail
    // one of them instead of both succeeding.
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const overlapping = await tx.workEvaluationPeriod.findFirst({
            where: overlappingWhere,
            select: { id: true, periodStart: true, periodEnd: true },
          });
          if (overlapping) {
            throw new ConflictException(
              `Period overlaps existing ${input.type} period ${overlapping.id} (${overlapping.periodStart.toISOString()} – ${overlapping.periodEnd.toISOString()})`,
            );
          }
          return tx.workEvaluationPeriod.create({
            data: {
              ruleSetVersionId: input.ruleSetVersionId,
              type: input.type,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("Concurrent period creation detected; retry the request");
      }
      throw error;
    }
  }

  /**
   * Advance a period through its lifecycle: UPCOMING → ACTIVE → CLOSED.
   * Skipping straight from UPCOMING to CLOSED is allowed (a period that
   * never opened); reopening a CLOSED period is not.
   */
  async transitionPeriodStatus(id: string, target: WorkEvaluationPeriodStatus): Promise<WorkEvaluationPeriod> {
    const period = await this.getPeriodById(id);
    const allowedTransitions: Record<WorkEvaluationPeriodStatus, WorkEvaluationPeriodStatus[]> = {
      [WorkEvaluationPeriodStatus.UPCOMING]: [WorkEvaluationPeriodStatus.ACTIVE, WorkEvaluationPeriodStatus.CLOSED],
      [WorkEvaluationPeriodStatus.ACTIVE]: [WorkEvaluationPeriodStatus.CLOSED],
      [WorkEvaluationPeriodStatus.CLOSED]: [],
    };
    if (!allowedTransitions[period.status].includes(target)) {
      throw new ConflictException(`Illegal period status transition ${period.status} → ${target}`);
    }
    // Conditional update: a concurrent transition that moved the row off the
    // status we validated makes this a no-op instead of silently winning.
    const updated = await this.prisma.workEvaluationPeriod.updateMany({
      where: { id, status: period.status },
      data: { status: target },
    });
    if (updated.count === 0) {
      throw new ConflictException(`Period ${id} status changed concurrently; retry the transition`);
    }
    return this.getPeriodById(id);
  }

  // --- Home ground -------------------------------------------------------

  /**
   * Declare (or re-declare) the specialty circle for one evaluatee × period.
   * Every declared criterion must exist in the criteria version the period is
   * pinned to — the circle is context for the evaluation agent and a typo'd
   * key would silently drop out of the judgment.
   */
  async declareHomeGround(input: UpdateWorkEvaluationHomeGroundRequestDto) {
    const period = await this.getPeriodById(input.collectionPeriodId);
    if (period.type !== WorkEvaluationPeriodType.COLLECTION) {
      throw new BadRequestException("Home ground can only be declared on COLLECTION periods");
    }
    const criteria = await this.criteria.listCriteria(period.ruleSetVersionId);
    const knownKeys = new Set(criteria.map((criterion) => criterion.criterionKey));
    const unknown = input.homeCriteria.filter((key) => !knownKeys.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `homeCriteria must reference criterion keys of criteria version ${period.ruleSetVersionId}: ${unknown.join(", ")}`,
      );
    }
    return this.prisma.workEvaluationHomeGround.upsert({
      where: {
        evaluateeUserId_collectionPeriodId: {
          evaluateeUserId: input.evaluateeUserId,
          collectionPeriodId: input.collectionPeriodId,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        homeCriteria: input.homeCriteria,
      },
      update: { homeCriteria: input.homeCriteria, declaredAt: new Date() },
    });
  }

  async getHomeGround(evaluateeUserId: string, collectionPeriodId: string) {
    const homeGround = await this.prisma.workEvaluationHomeGround.findUnique({
      where: {
        evaluateeUserId_collectionPeriodId: { evaluateeUserId, collectionPeriodId },
      },
    });
    if (!homeGround) {
      throw new NotFoundException(
        `Home ground for evaluatee ${evaluateeUserId} in period ${collectionPeriodId} not found`,
      );
    }
    return homeGround;
  }
}
