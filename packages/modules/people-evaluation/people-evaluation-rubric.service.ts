import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PeopleEvaluationPeriod,
  PeopleEvaluationPeriodStatus,
  PeopleEvaluationPeriodType,
  PeopleEvaluationRubricVersion,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  ListPeopleEvaluationPeriodsRequestDto,
  UpdatePeopleEvaluationHomeGroundRequestDto,
} from "./people-evaluation.dto";

/**
 * PeopleEvaluationRubricService — rubric versions, evaluation periods and the
 * home-ground declaration (ADR-029). These are the ex ante anchors: what is
 * judged, when, and against which declared specialty circle.
 */
@Injectable()
export class PeopleEvaluationRubricService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Rubric versions ---------------------------------------------------

  async findActiveRubric(): Promise<PeopleEvaluationRubricVersion | null> {
    return this.prisma.peopleEvaluationRubricVersion.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: "desc" },
      include: { dimensions: { orderBy: { dimensionKey: "asc" } } },
    });
  }

  /**
   * Create and publish a rubric version. Dimensions are written to their own
   * table — never into a JSON blob. Activation is atomic: publishing a new
   * version deactivates every other version in the same transaction so exactly
   * one rubric is active at a time.
   */
  async createRubricVersion(
    input: CreatePeopleEvaluationRubricVersionRequestDto,
  ): Promise<PeopleEvaluationRubricVersion> {
    const dimensionKeys = input.dimensions.map((dimension) => dimension.dimensionKey);
    if (new Set(dimensionKeys).size !== dimensionKeys.length) {
      throw new BadRequestException("Duplicate dimensionKey in rubric dimensions");
    }

    const publishedAt = input.publishedAt ?? new Date();
    const isActive = input.isActive ?? true;

    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        await tx.peopleEvaluationRubricVersion.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });
      }
      return tx.peopleEvaluationRubricVersion.create({
        data: {
          version: input.version,
          floorRules: input.floorRules,
          companyDirectionStatement: input.companyDirectionStatement,
          publishedAt,
          isActive,
          dimensions: {
            create: input.dimensions.map((dimension) => ({
              dimensionKey: dimension.dimensionKey,
              name: dimension.name,
              anchorLow: dimension.anchorLow,
              anchorHigh: dimension.anchorHigh,
              fullLoadBaseRef: dimension.fullLoadBaseRef,
              description: dimension.description,
              calibrationExamples: dimension.calibrationExamples,
            })),
          },
        },
        include: { dimensions: true },
      });
    });
  }

  // --- Evaluation periods ------------------------------------------------

  async listPeriods(query: ListPeopleEvaluationPeriodsRequestDto) {
    const where = query.type ? { type: query.type } : {};
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.PeopleEvaluationPeriod,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: { where, orderBy: [{ periodStart: "desc" }, { id: "asc" }] },
    });
  }

  async getPeriodById(id: string): Promise<PeopleEvaluationPeriod> {
    const period = await this.prisma.peopleEvaluationPeriod.findUnique({ where: { id } });
    if (!period) {
      throw new NotFoundException(`Evaluation period ${id} not found`);
    }
    return period;
  }

  async createPeriod(input: CreatePeopleEvaluationPeriodRequestDto): Promise<PeopleEvaluationPeriod> {
    const rubric = await this.prisma.peopleEvaluationRubricVersion.findUnique({
      where: { id: input.rubricVersionId },
    });
    if (!rubric) {
      throw new NotFoundException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} not found`);
    }
    if (!rubric.isActive) {
      throw new ConflictException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} is not active`);
    }
    if (input.periodStart >= input.periodEnd) {
      throw new BadRequestException("periodStart must be before periodEnd");
    }
    // Ex ante anchor: a period cannot start before its rubric was published.
    if (input.periodStart < rubric.publishedAt) {
      throw new BadRequestException(
        `Period cannot start before rubric ${rubric.version} was published at ${rubric.publishedAt.toISOString()}`,
      );
    }

    const overlapping = await this.prisma.peopleEvaluationPeriod.findFirst({
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
      if (input.type !== PeopleEvaluationPeriodType.REVIEW) {
        throw new BadRequestException("collectionPeriodIds is only allowed on REVIEW periods");
      }
      const collectionPeriods = await this.prisma.peopleEvaluationPeriod.findMany({
        where: { id: { in: input.collectionPeriodIds } },
        select: { id: true, type: true },
      });
      if (collectionPeriods.length !== input.collectionPeriodIds.length) {
        throw new BadRequestException("collectionPeriodIds contains unknown period ids");
      }
      const nonCollection = collectionPeriods.filter((period) => period.type !== PeopleEvaluationPeriodType.COLLECTION);
      if (nonCollection.length > 0) {
        throw new BadRequestException(
          `collectionPeriodIds must reference COLLECTION periods: ${nonCollection.map((period) => period.id).join(", ")}`,
        );
      }
    }

    return this.prisma.peopleEvaluationPeriod.create({
      data: {
        rubricVersionId: input.rubricVersionId,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? PeopleEvaluationPeriodStatus.UPCOMING,
        collectionPeriodIds: input.collectionPeriodIds,
      },
    });
  }

  /**
   * Advance a period through its lifecycle: UPCOMING → ACTIVE → CLOSED.
   * Skipping straight from UPCOMING to CLOSED is allowed (a period that
   * never opened); reopening a CLOSED period is not.
   */
  async transitionPeriodStatus(id: string, target: PeopleEvaluationPeriodStatus): Promise<PeopleEvaluationPeriod> {
    const period = await this.getPeriodById(id);
    const allowedTransitions: Record<PeopleEvaluationPeriodStatus, PeopleEvaluationPeriodStatus[]> = {
      [PeopleEvaluationPeriodStatus.UPCOMING]: [
        PeopleEvaluationPeriodStatus.ACTIVE,
        PeopleEvaluationPeriodStatus.CLOSED,
      ],
      [PeopleEvaluationPeriodStatus.ACTIVE]: [PeopleEvaluationPeriodStatus.CLOSED],
      [PeopleEvaluationPeriodStatus.CLOSED]: [],
    };
    if (!allowedTransitions[period.status].includes(target)) {
      throw new ConflictException(`Illegal period status transition ${period.status} → ${target}`);
    }
    return this.prisma.peopleEvaluationPeriod.update({ where: { id }, data: { status: target } });
  }

  // --- Home ground -------------------------------------------------------

  /**
   * Declare (or re-declare) the specialty circle for one evaluatee × period.
   * The declaration is context for the evaluation agent — it never carries
   * weights into any computation.
   */
  async declareHomeGround(input: UpdatePeopleEvaluationHomeGroundRequestDto) {
    const period = await this.getPeriodById(input.collectionPeriodId);
    if (period.type !== PeopleEvaluationPeriodType.COLLECTION) {
      throw new BadRequestException("Home ground can only be declared on COLLECTION periods");
    }
    return this.prisma.peopleEvaluationHomeGround.upsert({
      where: {
        evaluateeUserId_collectionPeriodId: {
          evaluateeUserId: input.evaluateeUserId,
          collectionPeriodId: input.collectionPeriodId,
        },
      },
      create: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        homeDimensions: input.homeDimensions,
      },
      update: { homeDimensions: input.homeDimensions, declaredAt: new Date() },
    });
  }

  async getHomeGround(evaluateeUserId: string, collectionPeriodId: string) {
    const homeGround = await this.prisma.peopleEvaluationHomeGround.findUnique({
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
