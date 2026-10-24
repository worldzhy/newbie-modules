import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreatePeopleEvaluationPipPlanRequestDto,
  CreatePeopleEvaluationResultInput,
  ListPeopleEvaluationPipPlansRequestDto,
  ListPeopleEvaluationResultsRequestDto,
  UpdatePeopleEvaluationPipPlanDecisionRequestDto,
  UpdatePeopleEvaluationResultReviewRequestDto,
} from "./people-evaluation.dto";

/**
 * PeopleEvaluationResultService — evaluation results and PIP plans (ADR-029).
 *
 * A result carries the deterministic material snapshot it was judged from
 * (manifest / coverageStats / contentHash) plus the model's judgments. Rerunning
 * produces a new result row; the snapshot of an older row is never replaced.
 *
 * Reviewers and PIP deciders are always the authenticated actor, passed in by
 * the controller from the JWT — never read from the request body.
 */
@Injectable()
export class PeopleEvaluationResultService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Evaluation results ------------------------------------------------

  async createResult(input: CreatePeopleEvaluationResultInput) {
    return this.prisma.peopleEvaluationResult.create({
      data: {
        evaluateeUserId: input.evaluateeUserId,
        collectionPeriodId: input.collectionPeriodId,
        manifest: input.manifest,
        contentHash: input.contentHash,
        coverageStats: input.coverageStats,
        blindSubjectId: input.blindSubjectId,
        promptVersion: input.promptVersion,
        model: input.model,
        dimensionScores: input.dimensionScores,
        overallText: input.overallText,
        highlights: input.highlights,
        risks: input.risks,
        unresolved: input.unresolved,
        skipped: input.skipped,
        disagreement: input.disagreement,
      },
    });
  }

  async listResults(query: ListPeopleEvaluationResultsRequestDto) {
    return this.prisma.peopleEvaluationResult.findMany({
      where: {
        evaluateeUserId: query.evaluateeUserId,
        ...(query.collectionPeriodId ? { collectionPeriodId: query.collectionPeriodId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getResult(id: string) {
    const result = await this.prisma.peopleEvaluationResult.findUnique({ where: { id } });
    if (!result) {
      throw new NotFoundException(`Evaluation result ${id} not found`);
    }
    return result;
  }

  /** Archived material snapshot of an evaluation result: the only manifest read path. */
  async getResultManifest(id: string) {
    const result = await this.prisma.peopleEvaluationResult.findUnique({
      where: { id },
      select: { contentHash: true, coverageStats: true, manifest: true },
    });
    if (!result) {
      throw new NotFoundException(`Evaluation result ${id} not found`);
    }
    return result;
  }

  /** Record the supervisor's final call on an evaluation result. */
  async updateResultReview(id: string, reviewerUserId: string, input: UpdatePeopleEvaluationResultReviewRequestDto) {
    await this.getResult(id);
    return this.prisma.peopleEvaluationResult.update({
      where: { id },
      data: {
        reviewedByUserId: reviewerUserId,
        reviewNote: input.reviewNote,
        reviewedAt: new Date(),
      },
    });
  }

  // --- PIP plans ---------------------------------------------------------

  /** Open a PIP plan. It carries no decision — that is recorded separately. */
  async createPipPlan(input: CreatePeopleEvaluationPipPlanRequestDto) {
    if (input.startDate >= input.endDate) {
      throw new BadRequestException("startDate must be before endDate");
    }
    return this.prisma.peopleEvaluationPipPlan.create({
      data: {
        evaluateeUserId: input.evaluateeUserId,
        triggerRefs: input.triggerRefs,
        startDate: input.startDate,
        endDate: input.endDate,
        checkpoints: input.checkpoints,
      },
    });
  }

  async listPipPlans(query: ListPeopleEvaluationPipPlansRequestDto) {
    return this.prisma.peopleEvaluationPipPlan.findMany({
      where: { evaluateeUserId: query.evaluateeUserId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Record the supervisor's decision on a PIP plan; the actor comes from the JWT. */
  async decidePipPlan(id: string, actorUserId: string, input: UpdatePeopleEvaluationPipPlanDecisionRequestDto) {
    const plan = await this.prisma.peopleEvaluationPipPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`PIP plan ${id} not found`);
    }
    return this.prisma.peopleEvaluationPipPlan.update({
      where: { id },
      data: {
        result: input.result,
        decisionNote: input.decisionNote,
        decidedByUserId: actorUserId,
        decidedAt: new Date(),
      },
    });
  }
}
