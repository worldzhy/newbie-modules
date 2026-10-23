import { Injectable, NotFoundException } from "@nestjs/common";
import { PeopleEvaluationPeriod, PeopleEvidenceSourceType, PeopleRubricVersion } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

/**
 * PeopleEvaluationService — core CRUD for people-evaluation module.
 *
 * This service owns the minimal persistence layer for rubric versions,
 * evaluation periods, collected evidence and computed scores. It does NOT
 * run the evaluation pipeline — evidence collection, machine scoring and
 * AI qualitative judgment are separate pipeline services that orchestrate
 * through this repository surface.
 *
 * Lifecycle anchor (ADR-021): rubric versions are published ex ante before
 * any period of that version starts. periods pin to exactly one rubric
 * version so all evaluatees inside a period score against identical rules.
 */
@Injectable()
export class PeopleEvaluationService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Rubric versions ---------------------------------------------------

  /**
   * Find the currently active rubric, or null if none exists.
   * v0.x pre-release: there may be no active rubric — seed one on host bootstrap.
   */
  async findActiveRubric(): Promise<PeopleRubricVersion | null> {
    return this.prisma.peopleRubricVersion.findFirst({ where: { isActive: true } });
  }

  async createRubricVersion(input: CreateRubricVersionInput): Promise<PeopleRubricVersion> {
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

  async listPeriods(periodType?: PeoplePeriodType): Promise<PeopleEvaluationPeriod[]> {
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

  async createPeriod(input: CreateEvaluationPeriodInput): Promise<PeopleEvaluationPeriod> {
    // Pin to an existing rubric version — the rubric must exist and the caller
    // is responsible for ensuring it's published ex ante before periodStart.
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
  async recordEvidence(input: RecordEvidenceInput): Promise<void> {
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

// --- Input types ---------------------------------------------------------
// Declared here instead of a separate DTO file so we don't force
// DTO-first scaffolding before controller lands. Moved to .dto.ts
// when controller is wired.

export interface CreateRubricVersionInput {
  version: string;
  dimensionConfig: object;
  fullLoadBaselines: object;
  floorRules: object;
  companyDirectionStatement: string;
  publishedAt?: Date;
  isActive?: boolean;
}

export type PeoplePeriodType = PeopleEvaluationPeriod["type"];

export interface CreateEvaluationPeriodInput {
  rubricVersionId: string;
  type: PeoplePeriodType;
  periodStart: Date;
  periodEnd: Date;
  status?: string;
}

export interface RecordEvidenceInput {
  evaluateeUserId: string;
  collectionPeriodId: string;
  sourceType: PeopleEvidenceSourceType;
  sourceRef?: string;
  dimensionKey?: string;
  payload: object;
  collectedAt?: Date;
}
