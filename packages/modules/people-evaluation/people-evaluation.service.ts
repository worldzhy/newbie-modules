import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationRubricVersion, PeopleEvaluationPeriod, PeriodType } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { CreateEvaluationPeriodDto, CreateRubricVersionDto, RecordEvidenceDto } from "./people-evaluation.dto";

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
    return this.prisma.peopleEvaluationRubricVersion.findFirst({ where: { isActive: true } });
  }

  async createRubricVersion(input: CreateRubricVersionDto): Promise<PeopleEvaluationRubricVersion> {
    return this.prisma.peopleEvaluationRubricVersion.create({
      data: {
        version: input.version,
        dimensionConfig: input.dimensionConfig,
        fullLoadBaselines: input.fullLoadBaselines,
        floorRules: input.floorRules,
        companyDirectionStatement: input.companyDirectionStatement,
        publishedAt: input.publishedAt ?? new Date(),
        isActive: input.isActive ?? true,
      },
    });
  }

  // --- Evaluation periods ------------------------------------------------

  async listPeriods(periodType?: PeriodType): Promise<PeopleEvaluationPeriod[]> {
    const where = periodType ? { type: periodType } : {};
    return this.prisma.peopleEvaluationPeriod.findMany({
      where,
      orderBy: [{ periodStart: "desc" }],
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

  async createPeriod(input: CreateEvaluationPeriodDto): Promise<PeopleEvaluationPeriod> {
    const rubric = await this.prisma.peopleEvaluationRubricVersion.findUnique({
      where: { id: input.rubricVersionId },
    });
    if (!rubric) {
      throw new NotFoundException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} not found`);
    }
    if (!rubric.isActive) {
      throw new ConflictException(`PeopleEvaluationRubricVersion ${input.rubricVersionId} is not active`);
    }

    return this.prisma.peopleEvaluationPeriod.create({
      data: {
        rubricVersionId: input.rubricVersionId,
        type: input.type,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: input.status ?? "upcoming",
      },
    });
  }

  // --- Evidence ----------------------------------------------------------

  /**
   * Append an evidence row. Called by collection pipeline workers
   * (git / incident / test-trend) or submitted by evaluatees themselves
   * as a work-deliverable payload.
   *
   * Idempotent on (collectionPeriodId, sourceRef): a duplicate sourceRef
   * converges onto the existing row instead of violating the unique
   * index. Rows are immutable once written — only dimensionKey follows
   * the latest write (attribution is the writer's responsibility), the
   * same contract as the collect-evidence runner upsert.
   */
  async recordEvidence(input: RecordEvidenceDto): Promise<void> {
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
