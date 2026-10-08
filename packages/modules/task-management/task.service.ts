import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";
import { CreateTaskItemDto, UpdateTaskRequestDto } from "./task.dto";

// Re-export the Prisma-generated enum so callers can keep importing it from the service module.
export { TaskStatus };

export interface Operator {
  id: string;
  name?: string;
  source: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  groupId: string;
  taskProjectId?: string;
  status?: TaskStatus;
  assigneeId?: string;
  dueDate?: Date;
  creatorId?: string;
}

export interface CreateTasksBatchInput {
  groupId: string;
  taskProjectId?: string;
  creatorId?: string;
  tasks: CreateTaskItemDto[];
}

export interface ListTasksFilter {
  groupId: string;
  status?: TaskStatus;
  keyword?: string;
  assigneeName?: string;
  taskProjectId?: string;
  includeCompleted?: boolean;
  skip?: number;
  take?: number;
}

const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, ReadonlySet<TaskStatus>>> = {
  [TaskStatus.PENDING]: new Set([TaskStatus.DEVELOPING, TaskStatus.CANCELLED]),
  [TaskStatus.DEVELOPING]: new Set([TaskStatus.TESTING, TaskStatus.CANCELLED]),
  [TaskStatus.TESTING]: new Set([TaskStatus.DEVELOPING, TaskStatus.DEPLOYED, TaskStatus.CANCELLED]),
  [TaskStatus.DEPLOYED]: new Set([TaskStatus.DEVELOPING, TaskStatus.COMPLETED, TaskStatus.CANCELLED]),
  [TaskStatus.COMPLETED]: new Set<TaskStatus>(),
  [TaskStatus.CANCELLED]: new Set<TaskStatus>(),
};

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createTask(data: CreateTaskInput) {
    return await this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        groupId: data.groupId,
        taskProjectId: data.taskProjectId,
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
        groupId: input.groupId,
        taskProjectId: input.taskProjectId,
        creatorId: input.creatorId,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
      })),
    });

    this.logger.log(`Batch created ${input.tasks.length} tasks in group ${input.groupId}`);
    return { count: input.tasks.length };
  }

  async listTasks(filter: ListTasksFilter) {
    const whereClause: any = {
      groupId: filter.groupId,
      deletedAt: null,
    };

    if (filter.status) {
      whereClause.status = filter.status;
    } else if (!filter.includeCompleted) {
      // If status is not specified and we shouldn't include completed, filter out COMPLETED and CANCELLED
      whereClause.status = {
        notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
      };
    }

    if (filter.keyword) {
      whereClause.title = {
        contains: filter.keyword,
        mode: "insensitive", // PostgreSQL only, ignore if using SQLite/MySQL without support
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

    if (filter.taskProjectId) {
      whereClause.taskProjectId = filter.taskProjectId;
    }

    const total = await this.prisma.task.count({ where: whereClause });

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: { creator: true, assignee: true, taskProject: true },
      orderBy: { createdAt: "desc" },
      skip: filter.skip,
      take: filter.take,
    });

    return { tasks, total };
  }

  async getTaskById(taskId: string) {
    return await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { creator: true, assignee: true, taskProject: true },
    });
  }

  async updateTask(taskId: string, dto: UpdateTaskRequestDto, operator: Operator) {
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

      if (current.status === dto.status) {
        // Idempotent: keep the current status but still allow updating other fields.
        nextStatus = current.status;
      } else if (!TASK_STATUS_TRANSITIONS[current.status].has(dto.status)) {
        throw new ConflictException(`Invalid task status transition: ${current.status} -> ${dto.status}`);
      } else {
        nextStatus = dto.status;
      }
    }

    return await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title,
        description: dto.description,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate,
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        lastOperatorId: operator.id,
        lastOperatorName: operator.name,
        lastOperatorSource: operator.source,
      },
    });
  }

  async deleteTask(taskId: string, operator: Operator) {
    return await this.prisma.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date(),
        lastOperatorId: operator.id,
        lastOperatorName: operator.name,
        lastOperatorSource: operator.source,
      },
    });
  }
}
