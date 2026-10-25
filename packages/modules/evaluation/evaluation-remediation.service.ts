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
  /**
   * Opaque host-side actor id of whoever records the decision. `deciderRef`
   * names the accountable decision maker; this records who actually acted, and
   * the two may differ (delegate, system closure). Required.
   */
  decidedByRef: string;
}

export interface UpdateEvaluationRemediationCheckpointInput {
  status: string;
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
    if (input.checkpoints) {
      const checkpointProblems = validateCheckpoints(input.checkpoints);
      if (checkpointProblems.length > 0) throw new BadRequestException(checkpointProblems);
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
    if (!input.decidedByRef?.trim()) throw new BadRequestException("decidedByRef is required");
    const updated = await this.prisma.evaluationRemediationPlan.updateMany({
      where: { id, status: EvaluationRemediationStatus.OPEN },
      data: {
        status: input.status as EvaluationRemediationStatus,
        decisionNote: input.decisionNote,
        decidedByRef: input.decidedByRef,
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

  /**
   * Progress one checkpoint of an open plan. Closing the plan freezes its
   * checkpoints: progress after a decision is a contradiction.
   */
  async updateCheckpoint(id: string, index: number, input: UpdateEvaluationRemediationCheckpointInput) {
    if (!input.status.trim()) throw new BadRequestException("checkpoint status is required");
    const plan = await this.requirePlan(id);
    if (plan.status !== EvaluationRemediationStatus.OPEN) {
      throw new ConflictException(`Evaluation remediation plan ${id} is already ${plan.status}`);
    }
    const checkpoints = (plan.checkpoints ?? []) as unknown as EvaluationRemediationCheckpoint[];
    if (!Array.isArray(checkpoints) || !Number.isInteger(index) || index < 0 || index >= checkpoints.length) {
      throw new NotFoundException(`Evaluation remediation plan ${id} has no checkpoint at index ${index}`);
    }
    checkpoints[index] = { ...checkpoints[index], status: input.status };
    return this.prisma.evaluationRemediationPlan.update({
      where: { id },
      data: { checkpoints: checkpoints as unknown as Prisma.InputJsonValue },
    });
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

/**
 * Checkpoints are stored as JSON, so the shape is enforced at the boundary:
 * each entry must be `{ dueDate, description, status }` with a parseable
 * dueDate and non-empty text fields.
 */
function validateCheckpoints(checkpoints: readonly EvaluationRemediationCheckpoint[]): string[] {
  const problems: string[] = [];
  checkpoints.forEach((checkpoint, index) => {
    if (typeof checkpoint !== "object" || checkpoint === null || Array.isArray(checkpoint)) {
      problems.push(`checkpoints[${index}] must be an object`);
      return;
    }
    if (typeof checkpoint.description !== "string" || !checkpoint.description.trim()) {
      problems.push(`checkpoints[${index}].description must be a non-empty string`);
    }
    if (typeof checkpoint.status !== "string" || !checkpoint.status.trim()) {
      problems.push(`checkpoints[${index}].status must be a non-empty string`);
    }
    if (typeof checkpoint.dueDate !== "string" || Number.isNaN(Date.parse(checkpoint.dueDate))) {
      problems.push(`checkpoints[${index}].dueDate must be a date string`);
    }
  });
  return problems;
}
