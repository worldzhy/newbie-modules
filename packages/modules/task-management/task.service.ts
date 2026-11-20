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
import { TaskStatus } from "@generated/prisma/enums";
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

export { TaskStatus };

export interface Operator {
  /** TaskActor row id of the operator, when the host resolved one. */
  actorId?: string;
  displayName?: string;
  /** Acting user; required when a write needs the plan-override authority. */
  userId?: string;
}

/** Declared change impact of a task; `designReviewRequired` is derived from it. */
export interface ChangeImpact {
  repos?: string[];
  touchesSchema?: boolean;
  touchesContracts?: boolean;
  irreversible?: boolean;
}

/** Origin discussion a task was created from, kept for clarification lookups. */
export interface OriginReference {
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
  projectId: string;
  status?: TaskStatus;
  assigneeId?: string;
  creatorId?: string;
  parentId?: string;
  designReference?: string;
  acceptanceCriteria?: string;
  allowedPaths?: string[];
  changeImpact?: ChangeImpact;
  prerequisiteTaskIds?: string[];
  originReference?: OriginReference;
  blockedReason?: string;
  designReferenceJustification?: string;
  requirementReview?: RequirementReview;
}

export interface CreateTasksBatchInput {
  projectId: string;
  creatorId?: string;
  tasks: CreateTaskItemDto[];
}

export interface ListTasksFilter {
  projectId: string;
  status?: TaskStatus;
  keyword?: string;
  assigneeName?: string;
  includeCompleted?: boolean;
  skip?: number;
  take?: number;
}

const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  [TaskStatus.PENDING]: new Set([TaskStatus.DEVELOPING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.BLOCKED]: new Set([TaskStatus.DEVELOPING, TaskStatus.CANCELLED]),
  [TaskStatus.DEVELOPING]: new Set([TaskStatus.TESTING, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.TESTING]: new Set([TaskStatus.DEVELOPING, TaskStatus.MERGED, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.MERGED]: new Set([TaskStatus.DEVELOPING, TaskStatus.DEPLOYED, TaskStatus.BLOCKED, TaskStatus.CANCELLED]),
  [TaskStatus.DEPLOYED]: new Set([
    TaskStatus.DEVELOPING,
    TaskStatus.BLOCKED,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ]),
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

/** Upper bound on declared path globs; more than this requires design review. */
export const MAX_ALLOWED_PATHS = 20;

/**
 * Whether a task needs a design review (ADR-054 D3). It is a pure function of
 * the declared change impact and the allowed path globs; callers never supply
 * it. Any single signal is enough:
 *
 * - the task spans several repositories;
 * - it touches the prisma schema or a cross-module contract;
 * - it is irreversible;
 * - it declares more than {@link MAX_ALLOWED_PATHS} allowed path globs.
 */
export function deriveDesignReviewRequired(
  changeImpact: ChangeImpact | null | undefined,
  allowedPaths: readonly string[],
): boolean {
  return (
    (changeImpact?.repos?.length ?? 0) > 1 ||
    changeImpact?.touchesSchema === true ||
    changeImpact?.touchesContracts === true ||
    changeImpact?.irreversible === true ||
    allowedPaths.length > MAX_ALLOWED_PATHS
  );
}

/** Facts gate 1 checks before a task may enter DEVELOPING (ADR-054 D4). */
export interface AdmissionInput {
  acceptanceCriteria?: string | null;
  parentId?: string | null;
  designReference?: string | null;
  designReviewRequired: boolean;
  allowedPaths: readonly string[];
  prerequisites: readonly string[];
  /** Status per prerequisite; a missing key means the prerequisite does not exist. */
  prerequisiteStatuses: ReadonlyMap<string, TaskStatus>;
}

export interface AdmissionVerdict {
  admitted: boolean;
  violations: string[];
}

/**
 * Host-independent half of gate 1 (ADR-054 D4): acceptance criteria, parent
 * state, prerequisite completion, plan shape, and `designReference` presence
 * when the derived plan requires a design review. `designReference`
 * resolvability and repo relevance need the workspace documents, so the host
 * prefilter checks them; this function only covers what the task record alone
 * can decide.
 */
export function evaluateAdmission(input: AdmissionInput): AdmissionVerdict {
  const violations: string[] = [];

  if (!input.acceptanceCriteria?.trim()) {
    violations.push("acceptanceCriteria is required before a task can start");
  }
  if (input.parentId) {
    violations.push("a design-unit task (parentId set) cannot start");
  }
  if (input.designReviewRequired && !input.designReference?.trim()) {
    violations.push("designReference is required when the task requires a design review");
  }
  if (input.allowedPaths.length === 0) {
    violations.push("allowedPaths is empty; declare the allowed path globs");
  } else if (input.allowedPaths.length > MAX_ALLOWED_PATHS) {
    violations.push(`allowedPaths has ${input.allowedPaths.length} entries; at most ${MAX_ALLOWED_PATHS} are allowed`);
  }
  for (const prerequisiteId of input.prerequisites) {
    const status = input.prerequisiteStatuses.get(prerequisiteId);
    if (!status) {
      violations.push(`prerequisite task ${prerequisiteId} does not exist`);
    } else if (status !== TaskStatus.COMPLETED) {
      violations.push(`prerequisite task ${prerequisiteId} is ${status}, not COMPLETED`);
    }
  }

  return { admitted: violations.length === 0, violations };
}

/**
 * Whether a plan edit needs the human override channel. `changeImpact`,
 * `allowedPaths` and the derived `designReviewRequired` freeze when the task
 * starts (ADR-054 D3). This record-level check only says *whether* the channel
 * is needed; `requiresPlanOverrideAuthority` and the service decide *who* holds
 * it.
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
 * non-empty `designReferenceJustification`, which is the human escape hatch
 * that skips the gate-1 design checks (ADR-054 D4). `Task:Update` alone is not
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

const TASK_RELATIONS = {
  creator: true,
  assignee: true,
  lastOperator: true,
  dependencies: { select: { prerequisiteTaskId: true } },
} as const;

/**
 * Flatten the prerequisite join rows into `prerequisiteTaskIds`, the shape the
 * API exposes. Join rows stay the only persisted representation. The framework
 * Prisma client is structurally `any` (see `ExtendedPrismaClient`), so the
 * returned row is typed loosely to keep every column the caller selected.
 */
function toTaskResponse(task: any): any {
  const { dependencies, ...rest } = task;
  return {
    ...rest,
    prerequisiteTaskIds: dependencies.map((row: { prerequisiteTaskId: string }) => row.prerequisiteTaskId),
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
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
    const allowedPaths = data.allowedPaths ?? [];
    const prerequisiteTaskIds = uniqueIds(data.prerequisiteTaskIds ?? []);

    // `designReferenceJustification` is the human escape hatch for gate 1, so
    // writing it needs the override authority even on creation.
    if (requiresPlanOverrideAuthority(null, false, { incoming: data.designReferenceJustification })) {
      await this.assertPlanOverrideAuthority(operator);
    }

    // Creating a task directly in DEVELOPING is an admission, so gate 1 runs
    // here too; a refused task lands in BLOCKED with the violations recorded
    // instead of starting work it would have to stop.
    if (requestedStatus === TaskStatus.DEVELOPING) {
      const verdict = await this.evaluateAdmission({
        acceptanceCriteria: data.acceptanceCriteria,
        parentId: data.parentId,
        designReference: data.designReference,
        designReferenceJustification: data.designReferenceJustification,
        changeImpact: data.changeImpact,
        allowedPaths,
        prerequisites: prerequisiteTaskIds,
      });
      if (!verdict.admitted) {
        status = TaskStatus.BLOCKED;
        blockedReason = formatGateOneBlock(verdict.violations);
      }
    }

    const created = await this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        status,
        assigneeId: data.assigneeId,
        creatorId: data.creatorId,
        parentId: data.parentId,
        designReference: data.designReference,
        designReviewRequired: deriveDesignReviewRequired(data.changeImpact, allowedPaths),
        acceptanceCriteria: data.acceptanceCriteria,
        allowedPaths,
        changeImpact: data.changeImpact as Prisma.InputJsonValue | undefined,
        originReference: data.originReference as Prisma.InputJsonValue | undefined,
        blockedReason,
        designReferenceJustification: data.designReferenceJustification,
        requirementReview: data.requirementReview as Prisma.InputJsonValue | undefined,
        planFrozenAt: status === TaskStatus.DEVELOPING ? new Date() : null,
        ...(prerequisiteTaskIds.length > 0
          ? { dependencies: { create: prerequisiteTaskIds.map((id) => ({ prerequisiteTaskId: id })) } }
          : {}),
      },
      include: TASK_RELATIONS,
    });
    return toTaskResponse(created);
  }

  async createTasksBatch(input: CreateTasksBatchInput, operator?: Operator): Promise<{ count: number }> {
    // A batch may create tasks straight into DEVELOPING, so it passes the same
    // gate; the host adjudicator is async and batched here too.
    if (
      input.tasks.some((task) =>
        requiresPlanOverrideAuthority(null, false, { incoming: task.designReferenceJustification }),
      )
    ) {
      await this.assertPlanOverrideAuthority(operator);
    }
    const statuses = await Promise.all(
      input.tasks.map((task) =>
        this.admissionStatus(task.status || TaskStatus.PENDING, {
          acceptanceCriteria: task.acceptanceCriteria,
          parentId: task.parentId,
          designReference: task.designReference,
          designReferenceJustification: task.designReferenceJustification,
          changeImpact: task.changeImpact,
          allowedPaths: task.allowedPaths ?? [],
          prerequisites: uniqueIds(task.prerequisiteTaskIds ?? []),
        }),
      ),
    );

    await this.prisma.$transaction(
      input.tasks.map((task, index) => {
        const status = statuses[index];
        const prerequisiteTaskIds = uniqueIds(task.prerequisiteTaskIds ?? []);
        const allowedPaths = task.allowedPaths ?? [];

        return this.prisma.task.create({
          data: {
            title: task.title,
            description: task.description,
            projectId: input.projectId,
            status: status.status,
            creatorId: input.creatorId,
            assigneeId: task.assigneeId,
            parentId: task.parentId,
            designReference: task.designReference,
            designReviewRequired: deriveDesignReviewRequired(task.changeImpact, allowedPaths),
            acceptanceCriteria: task.acceptanceCriteria,
            allowedPaths,
            changeImpact: task.changeImpact as Prisma.InputJsonValue | undefined,
            originReference: task.originReference as Prisma.InputJsonValue | undefined,
            blockedReason: status.blockedReason ?? task.blockedReason,
            designReferenceJustification: task.designReferenceJustification,
            requirementReview: task.requirementReview as Prisma.InputJsonValue | undefined,
            planFrozenAt: status.status === TaskStatus.DEVELOPING ? new Date() : null,
            ...(prerequisiteTaskIds.length > 0
              ? { dependencies: { create: prerequisiteTaskIds.map((id) => ({ prerequisiteTaskId: id })) } }
              : {}),
          },
        });
      }),
    );

    this.logger.log(`Batch created ${input.tasks.length} tasks in project ${input.projectId}`);
    return { count: input.tasks.length };
  }

  async listTasks(filter: ListTasksFilter) {
    const whereClause: Prisma.TaskWhereInput = {
      projectId: filter.projectId,
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
        displayName: {
          contains: cleanName,
          mode: "insensitive",
        },
      };
    }

    const total = await this.prisma.task.count({ where: whereClause });

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: TASK_RELATIONS,
      orderBy: { createdAt: "desc" },
      skip: filter.skip,
      take: filter.take,
    });

    return { tasks: tasks.map(toTaskResponse), total };
  }

  async getTaskById(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: TASK_RELATIONS,
    });
    return task ? toTaskResponse(task) : null;
  }

  async updateTask(taskId: string, dto: UpdateTaskRequestDto, operator: Operator) {
    let previousStatus: TaskStatus | undefined;
    let nextStatus: TaskStatus | undefined;
    let nextDesignReviewRequired: boolean | undefined;
    let blockedReason = dto.blockedReason;

    const planTouched = dto.changeImpact !== undefined || dto.allowedPaths !== undefined;
    const current =
      dto.status !== undefined || planTouched || dto.prerequisiteTaskIds !== undefined
        ? await this.prisma.task.findUnique({
            where: { id: taskId },
            select: {
              status: true,
              deletedAt: true,
              changeImpact: true,
              allowedPaths: true,
              acceptanceCriteria: true,
              parentId: true,
              designReference: true,
              designReferenceJustification: true,
              planFrozenAt: true,
              dependencies: { select: { prerequisiteTaskId: true } },
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

    // The plan freezes when the task starts: changeImpact, allowedPaths and the
    // derived designReviewRequired are only editable through the human override
    // channel afterwards (ADR-054 D3).
    const planFrozenAt = current?.planFrozenAt ?? null;
    const planOverride = planEditRequiresOverride(planFrozenAt, planTouched);
    // ADR-054 D3: only a human may rewrite a frozen plan or the gate-1
    // justification, so both writes need the override authority.
    if (
      requiresPlanOverrideAuthority(planFrozenAt, planTouched, {
        incoming: dto.designReferenceJustification,
        stored: current?.designReferenceJustification,
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
          "changeImpact and allowedPaths are frozen once the task starts; supply planOverrideReason to override",
        );
      }
      const changeImpact = (
        dto.changeImpact !== undefined ? dto.changeImpact : current.changeImpact
      ) as ChangeImpact | null;
      const allowedPaths = dto.allowedPaths !== undefined ? dto.allowedPaths : current.allowedPaths;
      nextDesignReviewRequired = deriveDesignReviewRequired(changeImpact, allowedPaths);
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
        designReference: dto.designReference !== undefined ? dto.designReference : current.designReference,
        designReferenceJustification:
          dto.designReferenceJustification !== undefined
            ? dto.designReferenceJustification
            : current.designReferenceJustification,
        changeImpact: (dto.changeImpact !== undefined ? dto.changeImpact : current.changeImpact) as ChangeImpact | null,
        allowedPaths: dto.allowedPaths !== undefined ? dto.allowedPaths : current.allowedPaths,
        prerequisites:
          dto.prerequisiteTaskIds !== undefined
            ? uniqueIds(dto.prerequisiteTaskIds).filter((id) => id !== taskId)
            : current.dependencies.map((row) => row.prerequisiteTaskId),
      });
      if (!verdict.admitted) {
        nextStatus = TaskStatus.BLOCKED;
        blockedReason = formatGateOneBlock(verdict.violations);
      }
    }

    const startsWork = nextStatus === TaskStatus.DEVELOPING && previousStatus !== undefined;
    const prerequisiteTaskIds =
      dto.prerequisiteTaskIds !== undefined
        ? uniqueIds(dto.prerequisiteTaskIds).filter((id) => id !== taskId)
        : undefined;

    // The status guard is part of the UPDATE, not just a prior read: two
    // concurrent transitions from the same source status would both pass the
    // check above and the later write would silently overwrite the first.
    // Matching `status: previousStatus` makes the loser match no row. The
    // prerequisite rows are replaced in the same transaction, so a failed guard
    // leaves the edges untouched too.
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRows = await tx.task.updateMany({
        where: {
          id: taskId,
          ...(previousStatus !== undefined ? { status: previousStatus, deletedAt: null } : {}),
        },
        data: {
          title: dto.title,
          description: dto.description,
          assigneeId: dto.assigneeId,
          parentId: dto.parentId,
          designReference: dto.designReference,
          designReviewRequired: nextDesignReviewRequired,
          acceptanceCriteria: dto.acceptanceCriteria,
          allowedPaths: dto.allowedPaths,
          changeImpact: dto.changeImpact as Prisma.InputJsonValue | undefined,
          originReference: dto.originReference as Prisma.InputJsonValue | undefined,
          blockedReason,
          designReferenceJustification: dto.designReferenceJustification,
          requirementReview: dto.requirementReview as Prisma.InputJsonValue | undefined,
          ...(startsWork && current?.planFrozenAt == null ? { planFrozenAt: new Date() } : {}),
          ...(nextStatus !== undefined ? { status: nextStatus } : {}),
          lastOperatorId: operator.actorId,
        },
      });

      if (updatedRows.count > 0 && prerequisiteTaskIds !== undefined) {
        await tx.taskDependency.deleteMany({ where: { taskId } });
        if (prerequisiteTaskIds.length > 0) {
          await tx.taskDependency.createMany({
            data: prerequisiteTaskIds.map((id) => ({ taskId, prerequisiteTaskId: id })),
          });
        }
      }
      return updatedRows;
    });
    if (result.count === 0) {
      // Distinguish "never existed" from "lost the concurrent-update race".
      if ((await this.prisma.task.count({ where: { id: taskId, deletedAt: null } })) === 0) {
        throw new NotFoundException("Task not found");
      }
      throw new ConflictException("The task was modified concurrently; reload it and retry.");
    }
    const updated = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: TASK_RELATIONS,
    });

    if (planOverride && planFrozenAt) {
      this.eventEmitter.emit(TASK_PLAN_OVERRIDE_EVENT, {
        taskId: updated.id,
        projectId: updated.projectId,
        fields: [
          ...(dto.changeImpact !== undefined ? ["changeImpact"] : []),
          ...(dto.allowedPaths !== undefined ? ["allowedPaths"] : []),
        ],
        reason: dto.planOverrideReason?.trim() ?? "",
        operatorActorId: operator.actorId,
        operatorName: operator.displayName,
        frozenAt: planFrozenAt.toISOString(),
      } satisfies TaskPlanOverrideEvent);
    }

    if (previousStatus !== undefined && nextStatus !== undefined && nextStatus !== previousStatus) {
      this.eventEmitter.emit(TASK_STATUS_CHANGED_EVENT, {
        taskId: updated.id,
        title: updated.title,
        projectId: updated.projectId,
        previousStatus,
        status: nextStatus,
        operatorName: operator.displayName,
      } satisfies TaskStatusChangedEvent);
    }

    return toTaskResponse(updated);
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
        `rewriting a frozen plan or its designReferenceJustification requires ${TASK_PLAN_OVERRIDE_RESOURCE}:Update`,
      );
    }
  }

  async deleteTask(taskId: string, operator: Operator) {
    const deleted = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date(),
        lastOperatorId: operator.actorId,
      },
      include: TASK_RELATIONS,
    });
    return toTaskResponse(deleted);
  }

  /** Resolve prerequisite completion in one query; missing rows stay absent. */
  private async loadPrerequisiteStatuses(ids: readonly string[]): Promise<Map<string, TaskStatus>> {
    const prerequisiteIds = uniqueIds(ids);
    if (prerequisiteIds.length === 0) return new Map();

    const prerequisites = await this.prisma.task.findMany({
      where: { id: { in: prerequisiteIds }, deletedAt: null },
      select: { id: true, status: true },
    });
    return new Map(prerequisites.map((task) => [task.id, task.status]));
  }

  private async evaluateAdmission(input: {
    acceptanceCriteria?: string | null;
    parentId?: string | null;
    designReference?: string | null;
    designReferenceJustification?: string | null;
    changeImpact?: ChangeImpact | null;
    allowedPaths: readonly string[];
    prerequisites: readonly string[];
  }): Promise<AdmissionVerdict> {
    const verdict = evaluateAdmission({
      acceptanceCriteria: input.acceptanceCriteria,
      parentId: input.parentId,
      designReference: input.designReference,
      designReviewRequired: deriveDesignReviewRequired(input.changeImpact, input.allowedPaths),
      allowedPaths: input.allowedPaths,
      prerequisites: input.prerequisites,
      prerequisiteStatuses: await this.loadPrerequisiteStatuses(input.prerequisites),
    });
    if (!verdict.admitted) return verdict;

    // The record cannot say whether `designReference` exists or which
    // repositories it declares; the host adjudicator answers that (ADR-054 D4,
    // gate 1).
    if (!this.planAdjudicator) return verdict;
    const hostVerdict: PlanAdjudicationVerdict = await this.planAdjudicator.adjudicate({
      designReference: input.designReference,
      designReferenceJustification: input.designReferenceJustification,
      changeImpactRepos: input.changeImpact?.repos ?? [],
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
    facts: {
      acceptanceCriteria?: string | null;
      parentId?: string | null;
      designReference?: string | null;
      designReferenceJustification?: string | null;
      changeImpact?: ChangeImpact | null;
      allowedPaths: readonly string[];
      prerequisites: readonly string[];
    },
  ): Promise<{ status: TaskStatus; blockedReason?: string }> {
    if (requestedStatus !== TaskStatus.DEVELOPING) {
      return { status: requestedStatus };
    }

    const verdict = await this.evaluateAdmission(facts);
    return verdict.admitted
      ? { status: TaskStatus.DEVELOPING }
      : { status: TaskStatus.BLOCKED, blockedReason: formatGateOneBlock(verdict.violations) };
  }
}

/** `blockedReason` prefix that tells a human which gate stopped the task. */
export function formatGateOneBlock(violations: readonly string[]): string {
  return `gate 1: ${violations.join("; ")}`;
}
