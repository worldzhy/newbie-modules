import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
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
 * Fields returned by every evaluation-result read. The archived `manifest`
 * snapshot is intentionally excluded — it is a large JSON blob served only by
 * the dedicated `GET /people/evaluation-results/:id/manifest` endpoint.
 */
const RESULT_SELECT = {
  id: true,
  evaluateeUserId: true,
  collectionPeriodId: true,
  blindSubjectId: true,
  promptVersion: true,
  model: true,
  dimensionScores: true,
  overallText: true,
  highlights: true,
  risks: true,
  unresolved: true,
  skipped: true,
  disagreement: true,
  coverageStats: true,
  reviewedByUserId: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
} satisfies Prisma.PeopleEvaluationResultSelect;

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
      select: RESULT_SELECT,
    });
  }

  async getResult(id: string) {
    const result = await this.prisma.peopleEvaluationResult.findUnique({ where: { id }, select: RESULT_SELECT });
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
      select: RESULT_SELECT,
    });
  }

  // --- PIP plans ---------------------------------------------------------

  /**
   * Open a PIP plan. It carries no decision — that is recorded separately.
   * Every triggerRef must be an existing evaluation result of the same
   * evaluatee, so a plan can never be anchored on another member's judgment.
   */
  async createPipPlan(input: CreatePeopleEvaluationPipPlanRequestDto) {
    if (input.startDate.getTime() >= input.endDate.getTime()) {
      throw new BadRequestException("startDate must be before endDate");
    }
    const referenced = await this.prisma.peopleEvaluationResult.findMany({
      where: { id: { in: input.triggerRefs } },
      select: { id: true, evaluateeUserId: true },
    });
    if (referenced.length !== new Set(input.triggerRefs).size) {
      throw new BadRequestException("triggerRefs contains unknown evaluation result ids");
    }
    const foreign = referenced.filter((result) => result.evaluateeUserId !== input.evaluateeUserId);
    if (foreign.length > 0) {
      throw new BadRequestException(
        `triggerRefs must reference results of evaluatee ${input.evaluateeUserId}: ${foreign.map((result) => result.id).join(", ")}`,
      );
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

  /**
   * Record the supervisor's decision on a PIP plan; the actor comes from the
   * JWT. A decided plan is final — reversing it means opening a new plan, so
   * a silent re-decision is rejected with 409.
   */
  async decidePipPlan(id: string, actorUserId: string, input: UpdatePeopleEvaluationPipPlanDecisionRequestDto) {
    const plan = await this.prisma.peopleEvaluationPipPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new NotFoundException(`PIP plan ${id} not found`);
    }
    if (plan.result !== null) {
      throw new ConflictException(`PIP plan ${id} is already decided as ${plan.result}`);
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
