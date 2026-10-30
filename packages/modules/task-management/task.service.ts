import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { Prisma } from "@generated/prisma/client";
import { TaskStatus } from "@generated/prisma/enums";
import { CreateTaskItemDto, UpdateTaskRequestDto } from "./task.dto";
import { TASK_STATUS_CHANGED_EVENT, type TaskStatusChangedEvent } from "./task-management.events";

export { TaskStatus };

export interface Operator {
  participantId?: string;
  name?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  spaceId: string;
  status?: TaskStatus;
  assigneeId?: string;
  dueDate?: Date;
  creatorId?: string;
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
  [TaskStatus.PENDING]: new Set([TaskStatus.DEVELOPING, TaskStatus.CANCELLED]),
  [TaskStatus.DEVELOPING]: new Set([TaskStatus.TESTING, TaskStatus.CANCELLED]),
  [TaskStatus.TESTING]: new Set([
    TaskStatus.DEVELOPING,
    TaskStatus.DEPLOYED,
    TaskStatus.COMPLETED,
    TaskStatus.CANCELLED,
  ]),
  [TaskStatus.DEPLOYED]: new Set([TaskStatus.DEVELOPING, TaskStatus.COMPLETED, TaskStatus.CANCELLED]),
  [TaskStatus.COMPLETED]: new Set<TaskStatus>(),
  [TaskStatus.CANCELLED]: new Set<TaskStatus>(),
};

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createTask(data: CreateTaskInput) {
    return await this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        spaceId: data.spaceId,
        status: data.status || TaskStatus.PENDING,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate,
        creatorId: data.creatorId,
      },
    });
  }

  async createTasksBatch(input: CreateTasksBatchInput): Promise<{ count: number }> {
    await this.prisma.task.createMany({
      data: input.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        status: task.status || TaskStatus.PENDING,
        spaceId: input.spaceId,
        creatorId: input.creatorId,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
      })),
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

    if (dto.status !== undefined) {
      const current = await this.prisma.task.findUnique({
        where: { id: taskId },
        select: { status: true, deletedAt: true },
      });

      if (!current) {
        throw new NotFoundException("Task not found");
      }
      if (current.deletedAt !== null) {
        throw new ConflictException("Cannot update a deleted task");
      }

      previousStatus = current.status;
      if (current.status === dto.status) {
        nextStatus = current.status;
      } else if (!TASK_STATUS_TRANSITIONS[current.status].has(dto.status)) {
        throw new ConflictException(`Invalid task status transition: ${current.status} -> ${dto.status}`);
      } else {
        nextStatus = dto.status;
      }
    }

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
}
