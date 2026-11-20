import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PERMISSION_AUTHORIZER, type PermissionAuthorizer } from "@modules/security/ports/permission.authorizer";
import { TaskChangeClass, TaskStatus } from "@generated/prisma/enums";
import { CreateTaskItemDto, UpdateTaskRequestDto } from "./task.dto";
import {
  TASK_PLAN_ADJUDICATOR,
  type PlanAdjudicationVerdict,
  type TaskPlanAdjudicator,
} from "./task-plan-adjudicator.port";
import {
  TASK_PLAN_OVERRIDE_EVENT,
  TASK_STATUS_CHANGED_EVENT,
  type TaskPlanOverrideEvent,
  type TaskStatusChangedEvent,
} from "./task-management.events";

export { TaskChangeClass, TaskStatus };

export interface Operator {
  participantId?: string;
  name?: string;
  /** Acting user; required when a write needs the plan-override authority. */
  userId?: string;
}

/** Declared change impact of a task; `changeClass` is derived from it. */
export interface TaskImpact {
  repos?: string[];
  touchesSchema?: boolean;
  touchesContracts?: boolean;
  irreversible?: boolean;
}

/** Origin discussion a task was created from, kept for clarification lookups. */
export interface TaskSourceRef {
  chatId?: string;
  messageId?: string;
}

/** Requirement-review summary written during the discussion stage. */
export interface RequirementReview {
  reportUrl?: string;
  contradictionCount?: number;
  coveredCount?: number;
  suggestionCount?: number;
  uncoveredCount?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  spaceId: string;
  status?: TaskStatus;
  assigneeId?: string;
  dueDate?: Date;
  creatorId?: string;
  parentId?: string;
  designRef?: string;
  acceptanceCriteria?: string;
  scopePaths?: string[];
  impact?: TaskImpact;
  dependsOn?: string[];
  sourceRef?: TaskSourceRef;
  blockedReason?: string;
  designRefJustification?: string;
  requirementReview?: RequirementReview;
}

export interface CreateTasksBatchInput {
  spaceId: string;
  creatorId?: string;
  tasks: CreateTaskItemDto[];
}

export interface ListTasksFilter {
  spaceId: string;
  status?: TaskStatus;
  keyword?: string;
  assigneeName?: string;
  includeCompleted?: boolean;
  skip?: number;
  take?: number;
}

const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  [TaskStatus.PENDING]: new Set([TaskStatus.DEVELOPING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.DEVELOPING]: new Set([TaskStatus.TESTING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.TESTING]: new Set([
    TaskStatus.DEVELOPING,
    TaskStatus.DEPLOYED,
    TaskStatus.BLOCKED,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ]),
  [TaskStatus.DEPLOYED]: new Set([
    TaskStatus.DEVELOPING,
    TaskStatus.BLOCKED,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ]),
  [TaskStatus.BLOCKED]: new Set([TaskStatus.DEVELOPING, TaskStatus.CANCELLED]),
  [TaskStatus.COMPLETED]: new Set<TaskStatus>(),
  [TaskStatus.CANCELLED]: new Set<TaskStatus>(),
};

/**
 * Whether a status update is allowed. An unchanged status is a no-op rather
 * than a transition, so it is permitted for every state.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_STATUS_TRANSITIONS[from].has(to);
}

/**
 * Delivery-plan class of a task (ADR-054 D3). It is a pure function of the
 * declared impact and the allowed path globs; callers never supply it.
 */
export function deriveChangeClass(
  impact: TaskImpact | null | undefined,
  scopePaths: readonly string[],
): TaskChangeClass {
  const designed =
    (impact?.repos?.length ?? 0) > 1 ||
    impact?.touchesSchema === true ||
    impact?.touchesContracts === true ||
    impact?.irreversible === true ||
    scopePaths.length > 20;
  return designed ? TaskChangeClass.DESIGNED : TaskChangeClass.SIMPLE;
}

/** Upper bound on declared path globs; more than this makes a task DESIGNED. */
export const MAX_SCOPE_PATHS = 20;

/** Facts gate 1 checks before a task may enter DEVELOPING (ADR-054 D4). */
export interface AdmissionInput {
  acceptanceCriteria?: string | null;
  parentId?: string | null;
  designRef?: string | null;
  changeClass?: TaskChangeClass | null;
  scopePaths: readonly string[];
  dependsOn: readonly string[];
  /** Status per dependency; a missing key means the dependency does not exist. */
  dependencyStatuses: ReadonlyMap<string, TaskStatus>;
}

export interface AdmissionVerdict {
  admitted: boolean;
  violations: string[];
}

/**
 * Host-independent half of gate 1 (ADR-054 D4): acceptance criteria, parent
 * state, dependency completion, plan shape, and `designRef` presence for
 * DESIGNED tasks. `designRef` resolvability and repo relevance need the
 * workspace documents, so the host prefilter checks them; this function only
 * covers what the task record alone can decide.
 */
export function evaluateAdmission(input: AdmissionInput): AdmissionVerdict {
  const violations: string[] = [];

  if (!input.acceptanceCriteria?.trim()) {
    violations.push("acceptanceCriteria is required before a task can start");
  }
  if (input.parentId) {
    violations.push("a design-unit task (parentId set) cannot start");
  }
  if (input.changeClass === TaskChangeClass.DESIGNED && !input.designRef?.trim()) {
    violations.push("designRef is required for a DESIGNED task");
  }
  if (input.scopePaths.length === 0) {
    violations.push("scopePaths is empty; declare the allowed path globs");
  } else if (input.scopePaths.length > MAX_SCOPE_PATHS) {
    violations.push(`scopePaths has ${input.scopePaths.length} entries; at most ${MAX_SCOPE_PATHS} are allowed`);
  }
  for (const dependencyId of input.dependsOn) {
    const status = input.dependencyStatuses.get(dependencyId);
    if (!status) {
      violations.push(`dependency ${dependencyId} does not exist`);
    } else if (status !== TaskStatus.COMPLETED) {
      violations.push(`dependency ${dependencyId} is ${status}, not COMPLETED`);
    }
  }

  return { admitted: violations.length === 0, violations };
}

/**
 * Whether a plan edit needs the human override channel. `impact`,
 * `scopePaths` and the derived `changeClass` freeze when the task starts
 * (ADR-054 D3). This record-level check only says *whether* the channel is
 * needed; `requiresPlanOverrideAuthority` and the service decide *who* holds it.
 */
export function planEditRequiresOverride(planFrozenAt: Date | null | undefined, touchesPlan: boolean): boolean {
  return planFrozenAt != null && touchesPlan;
}

/**
 * Virtual permission resource for the human-only override channel (ADR-054 D3:
 * "only a human may override, the agent has no write permission"). No route
 * decorator uses it; the service asks for `TaskPlanOverride:Update` directly.
 */
export const TASK_PLAN_OVERRIDE_RESOURCE = "TaskPlanOverride";

/**
 * Whether a write needs `TaskPlanOverride:Update`: a frozen plan edit, or a
 * non-empty `designRefJustification`, which is the human escape hatch that
 * skips the gate-1 design checks (ADR-054 D4). `Task:Update` alone is not
 * enough, otherwise the executor could waive the gate it has to obey.
 */
export function requiresPlanOverrideAuthority(
  planFrozenAt: Date | null | undefined,
  touchesPlan: boolean,
  justification: { incoming?: string; stored?: string | null },
): boolean {
  if (planEditRequiresOverride(planFrozenAt, touchesPlan)) return true;
  const incoming = justification.incoming?.trim();
  return Boolean(incoming) && incoming !== justification.stored?.trim();
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    // Hosts that can read the workspace bind a gate-1 adjudicator; without one
    // only the record-level admission rules run.
    @Optional()
    @Inject(TASK_PLAN_ADJUDICATOR)
    private readonly planAdjudicator?: TaskPlanAdjudicator,
    // Bound by the identity provider module (account). Without it every
    // override request is refused rather than silently allowed.
    @Optional()
    @Inject(PERMISSION_AUTHORIZER)
    private readonly permissions?: PermissionAuthorizer,
  ) {}

  async createTask(data: CreateTaskInput, operator?: Operator) {
    const requestedStatus = data.status || TaskStatus.PENDING;
    let status = requestedStatus;
    let blockedReason = data.blockedReason;

    // `designRefJustification` is the human escape hatch for gate 1, so writing
    // it needs the override authority even on creation.
    if (requiresPlanOverrideAuthority(null, false, { incoming: data.designRefJustification })) {
      await this.assertPlanOverrideAuthority(operator);
    }

    // Creating a task directly in DEVELOPING is an admission, so gate 1 runs
    // here too; a refused task lands in BLOCKED with the violations recorded
    // instead of starting work it would have to stop.
    if (requestedStatus === TaskStatus.DEVELOPING) {
      const verdict = await this.evaluateAdmission({
        acceptanceCriteria: data.acceptanceCriteria,
        parentId: data.parentId,
        designRef: data.designRef,
        designRefJustification: data.designRefJustification,
        impact: data.impact,
        scopePaths: data.scopePaths ?? [],
        dependsOn: data.dependsOn ?? [],
      });
      if (!verdict.admitted) {
        status = TaskStatus.BLOCKED;
        blockedReason = formatGateOneBlock(verdict.violations);
      }
    }

    return await this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        spaceId: data.spaceId,
        status,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate,
        creatorId: data.creatorId,
        parentId: data.parentId,
        designRef: data.designRef,
        acceptanceCriteria: data.acceptanceCriteria,
        scopePaths: data.scopePaths ?? [],
        impact: data.impact as Prisma.InputJsonValue | undefined,
        changeClass: deriveChangeClass(data.impact, data.scopePaths ?? []),
        dependsOn: data.dependsOn ?? [],
        sourceRef: data.sourceRef as Prisma.InputJsonValue | undefined,
        blockedReason,
        designRefJustification: data.designRefJustification,
        requirementReview: data.requirementReview as Prisma.InputJsonValue | undefined,
        planFrozenAt: status === TaskStatus.DEVELOPING ? new Date() : null,
      },
    });
  }

  async createTasksBatch(input: CreateTasksBatchInput, operator?: Operator): Promise<{ count: number }> {
    // A batch may create tasks straight into DEVELOPING, so it passes the same
    // gate; the host adjudicator is async and batched here too.
    if (
      input.tasks.some((task) => requiresPlanOverrideAuthority(null, false, { incoming: task.designRefJustification }))
    ) {
      await this.assertPlanOverrideAuthority(operator);
    }
    const statuses = await Promise.all(
      input.tasks.map((task) =>
        this.admissionStatus(task.status || TaskStatus.PENDING, {
          acceptanceCriteria: task.acceptanceCriteria,
          parentId: task.parentId,
          designRef: task.designRef,
          designRefJustification: task.designRefJustification,
          impact: task.impact,
          scopePaths: task.scopePaths ?? [],
          dependsOn: task.dependsOn ?? [],
        }),
      ),
    );

    await this.prisma.task.createMany({
      data: input.tasks.map((task, index) => {
        const status = statuses[index];

        return {
          title: task.title,
          description: task.description,
          status: status.status,
          spaceId: input.spaceId,
          creatorId: input.creatorId,
          assigneeId: task.assigneeId,
          dueDate: task.dueDate,
          parentId: task.parentId,
          designRef: task.designRef,
          acceptanceCriteria: task.acceptanceCriteria,
          scopePaths: task.scopePaths ?? [],
          impact: task.impact as Prisma.InputJsonValue | undefined,
          changeClass: deriveChangeClass(task.impact, task.scopePaths ?? []),
          dependsOn: task.dependsOn ?? [],
          sourceRef: task.sourceRef as Prisma.InputJsonValue | undefined,
          blockedReason: status.blockedReason ?? task.blockedReason,
          designRefJustification: task.designRefJustification,
          requirementReview: task.requirementReview as Prisma.InputJsonValue | undefined,
          planFrozenAt: status.status === TaskStatus.DEVELOPING ? new Date() : null,
        };
      }),
    });

    this.logger.log(`Batch created ${input.tasks.length} tasks in space ${input.spaceId}`);
    return { count: input.tasks.length };
  }

  async listTasks(filter: ListTasksFilter) {
    const whereClause: Prisma.TaskWhereInput = {
      spaceId: filter.spaceId,
      deletedAt: null,
    };

    if (filter.status) {
      whereClause.status = filter.status;
    } else if (!filter.includeCompleted) {
      whereClause.status = {
        notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
      };
    }

    if (filter.keyword) {
      whereClause.title = {
        contains: filter.keyword,
        mode: "insensitive",
      };
    }

    if (filter.assigneeName) {
      const cleanName = filter.assigneeName.replace(/^@/, "").trim();
      whereClause.assignee = {
        name: {
          contains: cleanName,
          mode: "insensitive",
        },
      };
    }

    const total = await this.prisma.task.count({ where: whereClause });

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: { creator: true, assignee: true, space: true },
      orderBy: { createdAt: "desc" },
      skip: filter.skip,
      take: filter.take,
    });

    return { tasks, total };
  }

  async getTaskById(taskId: string) {
    return await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { creator: true, assignee: true, space: true },
    });
  }

  async updateTask(taskId: string, dto: UpdateTaskRequestDto, operator: Operator) {
    let previousStatus: TaskStatus | undefined;
    let nextStatus: TaskStatus | undefined;
    let nextChangeClass: TaskChangeClass | undefined;
    let blockedReason = dto.blockedReason;

    const planTouched = dto.impact !== undefined || dto.scopePaths !== undefined;
    const current =
      dto.status !== undefined || planTouched
        ? await this.prisma.task.findUnique({
            where: { id: taskId },
            select: {
              status: true,
              deletedAt: true,
              impact: true,
              scopePaths: true,
              acceptanceCriteria: true,
              parentId: true,
              designRef: true,
              designRefJustification: true,
              dependsOn: true,
              planFrozenAt: true,
            },
          })
        : null;

    if (dto.status !== undefined) {
      if (!current) {
        throw new NotFoundException("Task not found");
      }
      if (current.deletedAt !== null) {
        throw new ConflictException("Cannot update a deleted task");
      }

      previousStatus = current.status;
      if (!canTransition(current.status, dto.status)) {
        throw new ConflictException(`Invalid task status transition: ${current.status} -> ${dto.status}`);
      }
      nextStatus = dto.status;

      if (nextStatus === TaskStatus.BLOCKED && nextStatus !== previousStatus && !blockedReason) {
        throw new ConflictException("blockedReason is required when a task moves to BLOCKED");
      }
    }

    // The plan freezes when the task starts: impact, scopePaths and the
    // derived changeClass are only editable through the human override
    // channel afterwards (ADR-054 D3).
    const planFrozenAt = current?.planFrozenAt ?? null;
    const planOverride = planEditRequiresOverride(planFrozenAt, planTouched);
    // ADR-054 D3: only a human may rewrite a frozen plan or the gate-1
    // justification, so both writes need the override authority.
    if (
      requiresPlanOverrideAuthority(planFrozenAt, planTouched, {
        incoming: dto.designRefJustification,
        stored: current?.designRefJustification,
      })
    ) {
      await this.assertPlanOverrideAuthority(operator);
    }

    if (planTouched) {
      if (!current) {
        throw new NotFoundException("Task not found");
      }
      if (planOverride && !dto.planOverrideReason?.trim()) {
        throw new ConflictException(
          "impact and scopePaths are frozen once the task starts; supply planOverrideReason to override",
        );
      }
      const impact = (dto.impact !== undefined ? dto.impact : current.impact) as TaskImpact | null;
      const scopePaths = dto.scopePaths !== undefined ? dto.scopePaths : current.scopePaths;
      nextChangeClass = deriveChangeClass(impact, scopePaths);
    }

    // Gate 1 (ADR-054 D4): PENDING and BLOCKED are the two states that can enter
    // DEVELOPING, and both run the admission rules. A refusal does not fail the
    // request — the task moves to BLOCKED with the violations recorded, which is
    // also what notifies the host through TASK_STATUS_CHANGED_EVENT.
    const admitsWork =
      dto.status === TaskStatus.DEVELOPING &&
      (current?.status === TaskStatus.PENDING || current?.status === TaskStatus.BLOCKED);
    if (admitsWork && current) {
      const verdict = await this.evaluateAdmission({
        acceptanceCriteria: dto.acceptanceCriteria !== undefined ? dto.acceptanceCriteria : current.acceptanceCriteria,
        parentId: dto.parentId !== undefined ? dto.parentId : current.parentId,
        designRef: dto.designRef !== undefined ? dto.designRef : current.designRef,
        designRefJustification:
          dto.designRefJustification !== undefined ? dto.designRefJustification : current.designRefJustification,
        impact: (dto.impact !== undefined ? dto.impact : current.impact) as TaskImpact | null,
        scopePaths: dto.scopePaths !== undefined ? dto.scopePaths : current.scopePaths,
        dependsOn: dto.dependsOn !== undefined ? dto.dependsOn : current.dependsOn,
      });
      if (!verdict.admitted) {
        nextStatus = TaskStatus.BLOCKED;
        blockedReason = formatGateOneBlock(verdict.violations);
      }
    }

    const startsWork = nextStatus === TaskStatus.DEVELOPING && previousStatus !== undefined;

    // The status guard is part of the UPDATE, not just a prior read: two
    // concurrent transitions from the same source status would both pass the
    // check above and the later write would silently overwrite the first.
    // Matching `status: previousStatus` makes the loser match no row.
    const result = await this.prisma.task.updateMany({
      where: {
        id: taskId,
        ...(previousStatus !== undefined ? { status: previousStatus, deletedAt: null } : {}),
      },
      data: {
        title: dto.title,
        description: dto.description,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate,
        parentId: dto.parentId,
        designRef: dto.designRef,
        acceptanceCriteria: dto.acceptanceCriteria,
        scopePaths: dto.scopePaths,
        impact: dto.impact as Prisma.InputJsonValue | undefined,
        changeClass: nextChangeClass,
        dependsOn: dto.dependsOn,
        sourceRef: dto.sourceRef as Prisma.InputJsonValue | undefined,
        blockedReason,
        designRefJustification: dto.designRefJustification,
        requirementReview: dto.requirementReview as Prisma.InputJsonValue | undefined,
        ...(startsWork && current?.planFrozenAt == null ? { planFrozenAt: new Date() } : {}),
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        lastOperatorParticipantId: operator.participantId,
        lastOperatorName: operator.name,
      },
    });
    if (result.count === 0) {
      // Distinguish "never existed" from "lost the concurrent-update race".
      if ((await this.prisma.task.count({ where: { id: taskId, deletedAt: null } })) === 0) {
        throw new NotFoundException("Task not found");
      }
      throw new ConflictException("The task was modified concurrently; reload it and retry.");
    }
    const updated = await this.prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    if (planOverride && planFrozenAt) {
      this.eventEmitter.emit(TASK_PLAN_OVERRIDE_EVENT, {
        taskId: updated.id,
        spaceId: updated.spaceId,
        fields: [
          ...(dto.impact !== undefined ? ["impact"] : []),
          ...(dto.scopePaths !== undefined ? ["scopePaths"] : []),
        ],
        reason: dto.planOverrideReason?.trim() ?? "",
        operatorParticipantId: operator.participantId,
        operatorName: operator.name,
        frozenAt: planFrozenAt.toISOString(),
      } satisfies TaskPlanOverrideEvent);
    }

    if (previousStatus !== undefined && nextStatus !== undefined && nextStatus !== previousStatus) {
      this.eventEmitter.emit(TASK_STATUS_CHANGED_EVENT, {
        taskId: updated.id,
        title: updated.title,
        spaceId: updated.spaceId,
        previousStatus,
        status: nextStatus,
        operatorName: operator.name,
      } satisfies TaskStatusChangedEvent);
    }

    return updated;
  }

  /**
   * Refuses the write unless the operator holds `TaskPlanOverride:Update`.
   * This is the executor-boundary check ADR-054 D3 requires: a missing actor or
   * a missing authorizer fails closed rather than letting an agent waive a gate.
   */
  private async assertPlanOverrideAuthority(operator: Operator | undefined): Promise<void> {
    const allowed =
      operator?.userId && this.permissions
        ? await this.permissions.authorize(operator.userId, {
            resource: TASK_PLAN_OVERRIDE_RESOURCE,
            action: PermissionAction.Update,
          })
        : false;
    if (!allowed) {
      throw new ForbiddenException(
        `rewriting a frozen plan or its designRefJustification requires ${TASK_PLAN_OVERRIDE_RESOURCE}:Update`,
      );
    }
  }

  async deleteTask(taskId: string, operator: Operator) {
    return await this.prisma.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date(),
        lastOperatorParticipantId: operator.participantId,
        lastOperatorName: operator.name,
      },
    });
  }

  /** Resolve dependency completion in one query; missing rows stay absent. */
  private async loadDependencyStatuses(ids: readonly string[]): Promise<Map<string, TaskStatus>> {
    const dependencyIds = [...new Set(ids)];
    if (dependencyIds.length === 0) return new Map();

    const dependencies = await this.prisma.task.findMany({
      where: { id: { in: dependencyIds }, deletedAt: null },
      select: { id: true, status: true },
    });
    return new Map(dependencies.map((dependency) => [dependency.id, dependency.status]));
  }

  private async evaluateAdmission(input: {
    acceptanceCriteria?: string | null;
    parentId?: string | null;
    designRef?: string | null;
    designRefJustification?: string | null;
    impact?: TaskImpact | null;
    scopePaths: readonly string[];
    dependsOn: readonly string[];
  }): Promise<AdmissionVerdict> {
    const verdict = evaluateAdmission({
      acceptanceCriteria: input.acceptanceCriteria,
      parentId: input.parentId,
      designRef: input.designRef,
      changeClass: deriveChangeClass(input.impact, input.scopePaths),
      scopePaths: input.scopePaths,
      dependsOn: input.dependsOn,
      dependencyStatuses: await this.loadDependencyStatuses(input.dependsOn),
    });
    if (!verdict.admitted) return verdict;

    // The record cannot say whether `designRef` exists or which repositories
    // it declares; the host adjudicator answers that (ADR-054 D4, gate 1).
    if (!this.planAdjudicator) return verdict;
    const hostVerdict: PlanAdjudicationVerdict = await this.planAdjudicator.adjudicate({
      designRef: input.designRef,
      designRefJustification: input.designRefJustification,
      impactRepos: input.impact?.repos ?? [],
    });
    return {
      admitted: hostVerdict.admitted,
      violations: [...verdict.violations, ...hostVerdict.violations],
    };
  }

  /**
   * Creation and transitions share the same refusal rule: only a start lands
   * in BLOCKED, never a task that is merely being created as PENDING.
   */
  private async admissionStatus(
    requestedStatus: TaskStatus,
    facts: Omit<AdmissionInput, "changeClass" | "dependencyStatuses"> & {
      impact?: TaskImpact | null;
      designRefJustification?: string | null;
    },
  ): Promise<{ status: TaskStatus; blockedReason?: string }> {
    if (requestedStatus !== TaskStatus.DEVELOPING) {
      return { status: requestedStatus };
    }

    const verdict = await this.evaluateAdmission({
      acceptanceCriteria: facts.acceptanceCriteria,
      parentId: facts.parentId,
      designRef: facts.designRef,
      designRefJustification: facts.designRefJustification,
      impact: facts.impact,
      scopePaths: facts.scopePaths,
      dependsOn: facts.dependsOn,
    });
    return verdict.admitted
      ? { status: TaskStatus.DEVELOPING }
      : { status: TaskStatus.BLOCKED, blockedReason: formatGateOneBlock(verdict.violations) };
  }
}

/** `blockedReason` prefix that tells a human which gate stopped the task. */
export function formatGateOneBlock(violations: readonly string[]): string {
  return `gate 1: ${violations.join("; ")}`;
}
