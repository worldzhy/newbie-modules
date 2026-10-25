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
    const version = await this.criteria.getVersion(input.criteriaVersionId);
    if (version.kind !== WORK_EVALUATION_SUBJECT_KIND) {
      throw new BadRequestException(
        `Criteria version ${version.family}/${version.version} judges kind "${version.kind}", not "${WORK_EVALUATION_SUBJECT_KIND}"`,
      );
    }
    if (!version.publishedAt) {
      throw new ConflictException(
        `Criteria version ${version.family}/${version.version} is a draft and cannot anchor a period`,
      );
    }
    if (input.periodStart.getTime() >= input.periodEnd.getTime()) {
      throw new BadRequestException("periodStart must be before periodEnd");
    }
    // Ex ante anchor: a period cannot start before its criteria were published.
    if (input.periodStart.getTime() < version.publishedAt.getTime()) {
      throw new BadRequestException(
        `Period cannot start before criteria version ${version.family}/${version.version} was published at ${version.publishedAt.toISOString()}`,
      );
    }

    const overlapping = await this.prisma.workEvaluationPeriod.findFirst({
      where: {
        type: input.type,
        periodStart: { lt: input.periodEnd },
        periodEnd: { gt: input.periodStart },
      },
      select: { id: true, periodStart: true, periodEnd: true },
    });
    if (overlapping) {
      throw new ConflictException(
        `Period overlaps existing ${input.type} period ${overlapping.id} (${overlapping.periodStart.toISOString()} – ${overlapping.periodEnd.toISOString()})`,
      );
    }

    if (input.collectionPeriodIds && input.collectionPeriodIds.length > 0) {
      if (input.type !== WorkEvaluationPeriodType.REVIEW) {
        throw new BadRequestException("collectionPeriodIds is only allowed on REVIEW periods");
      }
      const collectionPeriods = await this.prisma.workEvaluationPeriod.findMany({
        where: { id: { in: input.collectionPeriodIds } },
        select: { id: true, type: true },
      });
      if (collectionPeriods.length !== input.collectionPeriodIds.length) {
        throw new BadRequestException("collectionPeriodIds contains unknown period ids");
      }
      const nonCollection = collectionPeriods.filter((period) => period.type !== WorkEvaluationPeriodType.COLLECTION);
      if (nonCollection.length > 0) {
        throw new BadRequestException(
          `collectionPeriodIds must reference COLLECTION periods: ${nonCollection.map((period) => period.id).join(", ")}`,
        );
      }
    }

    return this.prisma.workEvaluationPeriod.create({
      data: {
        criteriaVersionId: input.criteriaVersionId,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        collectionPeriodIds: input.collectionPeriodIds,
      },
    });
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
    return this.prisma.workEvaluationPeriod.update({ where: { id }, data: { status: target } });
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
    const criteria = await this.criteria.listCriteria(period.criteriaVersionId);
    const knownKeys = new Set(criteria.map((criterion) => criterion.criterionKey));
    const unknown = input.homeCriteria.filter((key) => !knownKeys.has(key));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `homeCriteria must reference criterion keys of criteria version ${period.criteriaVersionId}: ${unknown.join(", ")}`,
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
