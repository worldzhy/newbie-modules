import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationPeriod, PeopleRubricVersion, PeriodType } from "@generated/prisma/client";
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

  async findActiveRubric(): Promise<PeopleRubricVersion | null> {
    return this.prisma.peopleRubricVersion.findFirst({ where: { isActive: true } });
  }

  async createRubricVersion(input: CreateRubricVersionDto): Promise<PeopleRubricVersion> {
    return this.prisma.peopleRubricVersion.create({
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

  async getPeriod(id: string): Promise<PeopleEvaluationPeriod> {
    const period = await this.prisma.peopleEvaluationPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException(`PeopleEvaluationPeriod ${id} not found`);
    return period;
  }

  async createPeriod(input: CreateEvaluationPeriodDto): Promise<PeopleEvaluationPeriod> {
    const rubric = await this.prisma.peopleRubricVersion.findUnique({
      where: { id: input.rubricVersionId },
    });
    if (!rubric) {
      throw new NotFoundException(`PeopleRubricVersion ${input.rubricVersionId} not found`);
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
   */
  async recordEvidence(input: RecordEvidenceDto): Promise<void> {
    await this.prisma.peopleEvaluationEvidence.create({
      data: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        dimensionKey: input.dimensionKey,
        payload: input.payload,
        collectedAt: input.collectedAt ?? new Date(),
      },
    });
  }
}
