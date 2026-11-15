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
  triggerIds: readonly string[];
  /** The named decision maker — required, never derived from the request actor. */
  decider: string;
  startOn: Date;
  dueOn?: Date;
  checkpoints?: readonly EvaluationRemediationCheckpoint[];
}

export interface DecideEvaluationRemediationPlanInput {
  status: "COMPLETED" | "CANCELLED";
  decisionNote?: string;
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
 * A plan answers to findings or results of the same subject; `triggerIds` is
 * validated against this schema's tables on creation, so a plan can never be
 * anchored on material that does not exist or belongs to another subject.
 */
@Injectable()
export class EvaluationRemediationService {
  constructor(private readonly prisma: PrismaService) {}

  async createPlan(input: CreateEvaluationRemediationPlanInput) {
    if (!input.decider.trim()) throw new BadRequestException("decider is required");
    if (input.triggerIds.length === 0) throw new BadRequestException("triggerIds must not be empty");
    if (input.dueOn && input.dueOn.getTime() <= input.startOn.getTime()) {
      throw new BadRequestException("dueOn must be after startOn");
    }
    if (input.checkpoints) {
      const checkpointProblems = validateCheckpoints(input.checkpoints);
      if (checkpointProblems.length > 0) throw new BadRequestException(checkpointProblems);
    }

    const subject = await this.prisma.evaluationSubject.findUnique({ where: { id: input.subjectId } });
    if (!subject) throw new NotFoundException(`Evaluation subject ${input.subjectId} not found`);

    const refs = [...new Set(input.triggerIds)];
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
        `triggerIds must reference findings or results of subject ${input.subjectId}: unknown ${unknown.join(", ")}`,
      );
    }

    return this.prisma.evaluationRemediationPlan.create({
      data: {
        subjectId: input.subjectId,
        triggerIds: refs as unknown as Prisma.InputJsonValue,
        decider: input.decider,
        startOn: input.startOn,
        dueOn: input.dueOn,
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
    // Conditional write: a decision landing between the read and this write
    // freezes the checkpoints — progress on a closed plan is a contradiction.
    const written = await this.prisma.evaluationRemediationPlan.updateMany({
      where: { id, status: EvaluationRemediationStatus.OPEN },
      data: { checkpoints: checkpoints as unknown as Prisma.InputJsonValue },
    });
    if (written.count === 0) {
      throw new ConflictException(
        `Evaluation remediation plan ${id} was closed while the checkpoint was being updated`,
      );
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
