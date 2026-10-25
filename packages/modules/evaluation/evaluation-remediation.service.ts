import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { EvaluationRemediationStatus, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

export interface EvaluationRemediationCheckpoint {
  dueDate: string;
  description: string;
  status: string;
}

export interface CreateEvaluationRemediationPlanInput {
  subjectId: string;
  /** Finding or result ids that triggered the plan; all must exist in this subject. */
  triggerRefs: readonly string[];
  /** The named decision maker — required, never derived from the request actor. */
  deciderRef: string;
  startDate: Date;
  dueDate?: Date;
  checkpoints?: readonly EvaluationRemediationCheckpoint[];
}

export interface DecideEvaluationRemediationPlanInput {
  status: "COMPLETED" | "CANCELLED";
  decisionNote?: string;
}

export interface ListEvaluationRemediationPlansInput {
  subjectId: string;
  status?: EvaluationRemediationStatus;
  page?: number;
  pageSize?: number;
}

/**
 * EvaluationRemediationService — the remediation object (ADR-020 D1).
 *
 * A plan answers to findings or results of the same subject; `triggerRefs` is
 * validated against this schema's tables on creation, so a plan can never be
 * anchored on material that does not exist or belongs to another subject.
 */
@Injectable()
export class EvaluationRemediationService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(input: CreateEvaluationRemediationPlanInput) {
    if (!input.deciderRef.trim()) throw new BadRequestException("deciderRef is required");
    if (input.triggerRefs.length === 0) throw new BadRequestException("triggerRefs must not be empty");
    if (input.dueDate && input.dueDate.getTime() <= input.startDate.getTime()) {
      throw new BadRequestException("dueDate must be after startDate");
    }

    const subject = await this.prisma.evaluationSubject.findUnique({ where: { id: input.subjectId } });
    if (!subject) throw new NotFoundException(`Evaluation subject ${input.subjectId} not found`);

    const refs = [...new Set(input.triggerRefs)];
    const [findings, results] = await Promise.all([
      this.prisma.evaluationFinding.findMany({
        where: { id: { in: refs }, subjectId: input.subjectId },
        select: { id: true },
      }),
      this.prisma.evaluationResult.findMany({
        where: { id: { in: refs }, subjectId: input.subjectId },
        select: { id: true },
      }),
    ]);
    const known = new Set([...findings, ...results].map((row) => row.id));
    const unknown = refs.filter((ref) => !known.has(ref));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `triggerRefs must reference findings or results of subject ${input.subjectId}: unknown ${unknown.join(", ")}`,
      );
    }

    return this.prisma.evaluationRemediationPlan.create({
      data: {
        subjectId: input.subjectId,
        triggerRefs: refs as unknown as Prisma.InputJsonValue,
        deciderRef: input.deciderRef,
        startDate: input.startDate,
        dueDate: input.dueDate,
        checkpoints: input.checkpoints as unknown as Prisma.InputJsonValue | undefined,
      },
    });
  }

  /**
   * Close a plan exactly once. The conditional update guards the
   * read-check-write race: only the request that flips the row out of OPEN
   * wins, the other sees the plan already closed.
   */
  async decidePlan(id: string, input: DecideEvaluationRemediationPlanInput) {
    const updated = await this.prisma.evaluationRemediationPlan.updateMany({
      where: { id, status: EvaluationRemediationStatus.OPEN },
      data: {
        status: input.status as EvaluationRemediationStatus,
        decisionNote: input.decisionNote,
        decidedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const plan = await this.prisma.evaluationRemediationPlan.findUnique({ where: { id } });
      if (!plan) throw new NotFoundException(`Evaluation remediation plan ${id} not found`);
      throw new ConflictException(`Evaluation remediation plan ${id} is already ${plan.status}`);
    }
    return this.requirePlan(id);
  }

  async getPlan(id: string) {
    return this.requirePlan(id);
  }

  async listPlans(query: ListEvaluationRemediationPlansInput) {
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.EvaluationRemediationPlan,
      pagination: { page: query.page, pageSize: query.pageSize },
      findManyArgs: {
        where: {
          subjectId: query.subjectId,
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      },
    });
  }

  private async requirePlan(id: string) {
    const plan = await this.prisma.evaluationRemediationPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException(`Evaluation remediation plan ${id} not found`);
    return plan;
  }
}
