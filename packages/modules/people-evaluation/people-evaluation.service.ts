import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  PeopleEvaluationRubricVersion,
  PeopleEvaluationPeriod,
  PeriodStatus,
  PeriodType,
  Prisma,
} from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreatePeopleEvaluationPeriodRequestDto,
  CreatePeopleEvaluationRubricVersionRequestDto,
  ListPeopleEvaluationPeriodsRequestDto,
  RecordPeopleEvaluationEvidenceRequestDto,
} from "./people-evaluation.dto";

/**
 * PeopleEvaluationService — persistence layer for rubric versions,
 * evaluation periods, collected evidence and computed scores.
 *
 * This service does NOT run the evaluation pipeline — evidence
 * collection, machine scoring and AI qualitative judgment are
 * orchestrated through this repository surface by host-side runners.
 *
 * Lifecycle anchor (ADR-021): rubric versions are published ex ante
 * before any period of that version starts; periods pin to exactly one
 * rubric version so all evaluatees inside a period score against
 * identical rules.
 */
@Injectable()
export class PeopleEvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Rubric versions ---------------------------------------------------

  async findActiveRubric(): Promise<PeopleEvaluationRubricVersion | null> {
    return this.prisma.peopleEvaluationRubricVersion.findFirst({
      where: { isActive: true },
      orderBy: { publishedAt: "desc" },
      include: { evaluationDimensions: { orderBy: { dimensionKey: "asc" } } },
    });
  }

  /**
   * Create and publish a rubric version. Dimensions are written to their
   * own table (the single source of truth for scoring) — never into a
   * JSON blob. Activation is atomic: publishing a new version deactivates
   * every other version in the same transaction so exactly one rubric is
   * active at a time.
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
          scoringConfig: input.scoringConfig,
          publishedAt,
          isActive,
          evaluationDimensions: {
            create: input.dimensions.map((dimension) => ({
              dimensionKey: dimension.dimensionKey,
              name: dimension.name,
              anchorLow: dimension.anchorLow,
              anchorHigh: dimension.anchorHigh,
              fullLoadBaseRef: dimension.fullLoadBaseRef,
              description: dimension.description,
            })),
          },
        },
        include: { evaluationDimensions: true },
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
    const period = await this.prisma.peopleEvaluationPeriod.findUnique({
      where: { id },
    });
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
      if (input.type !== PeriodType.REVIEW) {
        throw new BadRequestException("collectionPeriodIds is only allowed on REVIEW periods");
      }
      const collectionPeriods = await this.prisma.peopleEvaluationPeriod.findMany({
        where: { id: { in: input.collectionPeriodIds } },
        select: { id: true, type: true },
      });
      if (collectionPeriods.length !== input.collectionPeriodIds.length) {
        throw new BadRequestException("collectionPeriodIds contains unknown period ids");
      }
      const nonCollection = collectionPeriods.filter((period) => period.type !== PeriodType.COLLECTION);
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
        status: input.status ?? PeriodStatus.UPCOMING,
        collectionPeriodIds: input.collectionPeriodIds,
      },
    });
  }

  /**
   * Advance a period through its lifecycle: UPCOMING → ACTIVE → CLOSED.
   * Skipping straight from UPCOMING to CLOSED is allowed (a period that
   * never opened); reopening a CLOSED period is not.
   */
  async transitionPeriodStatus(id: string, target: PeriodStatus): Promise<PeopleEvaluationPeriod> {
    const period = await this.getPeriodById(id);
    const allowedTransitions: Record<PeriodStatus, PeriodStatus[]> = {
      [PeriodStatus.UPCOMING]: [PeriodStatus.ACTIVE, PeriodStatus.CLOSED],
      [PeriodStatus.ACTIVE]: [PeriodStatus.CLOSED],
      [PeriodStatus.CLOSED]: [],
    };
    if (!allowedTransitions[period.status].includes(target)) {
      throw new ConflictException(`Illegal period status transition ${period.status} → ${target}`);
    }
    return this.prisma.peopleEvaluationPeriod.update({
      where: { id },
      data: { status: target },
    });
  }

  // --- Evidence ----------------------------------------------------------

  /**
   * Append an evidence row. Called by collection pipeline workers
   * (git / incident / test-trend) or submitted by evaluatees themselves
   * as a work-deliverable payload.
   *
   * Evidence may only land in COLLECTION periods — REVIEW periods are
   * decision windows and must not absorb new facts after the fact.
   *
   * Idempotent on (collectionPeriodId, sourceRef): a duplicate sourceRef
   * converges onto the existing row instead of violating the unique
   * index. Rows are immutable once written — only dimensionKey follows
   * the latest write (attribution is the writer's responsibility), the
   * same contract as the collect-evidence runner upsert.
   */
  async recordEvidence(input: RecordPeopleEvaluationEvidenceRequestDto): Promise<void> {
    const period = await this.getPeriodById(input.collectionPeriodId);
    if (period.type !== PeriodType.COLLECTION) {
      throw new BadRequestException(`Evidence can only be recorded into COLLECTION periods (${period.type})`);
    }

    const data = {
      evaluateeUserId: input.evaluateeUserId,
      collectionPeriodId: input.collectionPeriodId,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      dimensionKey: input.dimensionKey,
      payload: input.payload,
      eventAt: input.eventAt ?? new Date(),
    };

    if (!input.sourceRef) {
      await this.prisma.peopleEvaluationEvidence.create({ data });
      return;
    }

    await this.prisma.peopleEvaluationEvidence.upsert({
      where: {
        collectionPeriodId_sourceRef: {
          collectionPeriodId: input.collectionPeriodId,
          sourceRef: input.sourceRef,
        },
      },
      create: data,
      update: {
        dimensionKey: input.dimensionKey,
      },
    });
  }
}
