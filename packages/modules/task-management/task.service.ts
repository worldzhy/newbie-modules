import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";

// Re-export the Prisma-generated enum so callers can keep importing it from the service module.
export { TaskStatus };

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
}

export interface UpdateTaskDto {
  status?: TaskStatus;
  title?: string;
  description?: string;
  assigneeId?: string;
  taskProjectId?: string;
  dueDate?: Date;
  lastOperatorId?: string;
  lastOperatorName?: string;
  lastOperatorSource?: string;
  deletedAt?: Date;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- Task Management ---

  async createTasks(
    chatId: string,
    userId: string | undefined,
    tasks: TaskItem[],
    operator?: { id: string; name?: string; source: string },
    requirementId?: number,
    taskProjectId?: string,
  ) {
    try {
      // 1. Ensure Group exists or use Default
      let groupId: string;
      if (chatId) {
        let group = await this.prisma.taskGroup.findUnique({ where: { chatId } });
        if (!group) {
          group = await this.prisma.taskGroup.create({
            data: { chatId, name: `Project Group ${chatId.slice(-4)}` },
          });
        }
        groupId = group.id;
      } else {
        const defaultGroup = await this.prisma.taskGroup.upsert({
          where: { chatId: "DEFAULT_GROUP" },
          update: {},
          create: { chatId: "DEFAULT_GROUP", name: "Default Task Group" },
        });
        groupId = defaultGroup.id;
      }

      // 2. Ensure User exists (if userId is provided)
      let dbUserId: string | undefined;
      if (userId) {
        let user = await this.prisma.taskUser.findUnique({ where: { openId: userId } });
        if (!user) {
          user = await this.prisma.taskUser.create({
            data: { openId: userId, name: `User ${userId.slice(-4)}` },
          });
        }
        dbUserId = user.id;
      }

      // 3. Create Tasks
      await this.prisma.task.createMany({
        data: tasks.map((t) => ({
          title: t.title,
          description: t.description,
          status: t.status,
          groupId: groupId,
          creatorId: dbUserId,
          assigneeId: dbUserId, // Default assignee is the current operator (the person who requested the breakdown)
          lastOperatorId: operator?.id,
          lastOperatorName: operator?.name,
          lastOperatorSource: operator?.source,
          requirementId: requirementId,
          taskProjectId: taskProjectId,
        })),
      });

      this.logger.log(`Tasks saved to DB for ${chatId || "DEFAULT"}:`, tasks);
      const group = await this.prisma.taskGroup.findUnique({ where: { id: groupId } });
      return { count: tasks.length, groupName: group?.name || "Default Group" };
    } catch (error) {
      this.logger.error("Failed to save tasks to database", error);
      throw error;
    }
  }

  async listTasks(
    groupId: string,
    status?: TaskStatus,
    title?: string,
    assigneeName?: string,
    taskProjectId?: string,
    includeCompleted?: boolean,
    skip?: number,
    take?: number,
  ) {
    const whereClause: any = {
      groupId,
      deletedAt: null,
    };

    if (status) {
      whereClause.status = status;
    } else if (!includeCompleted) {
      // If status is not specified and we shouldn't include completed, filter out COMPLETED and CANCELLED
      whereClause.status = {
        notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
      };
    }

    if (title) {
      whereClause.title = {
        contains: title,
        mode: "insensitive", // PostgreSQL only, ignore if using SQLite/MySQL without support
      };
    }

    if (assigneeName) {
      const cleanName = assigneeName.replace(/^@/, "").trim();
      whereClause.assignee = {
        name: {
          contains: cleanName,
          mode: "insensitive",
        },
      };
    }

    if (taskProjectId) {
      whereClause.taskProjectId = taskProjectId;
    }

    const total = await this.prisma.task.count({ where: whereClause });

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: { creator: true, assignee: true, taskProject: true },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });

    return { tasks, total };
  }

  async getTaskById(taskId: string) {
    return await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { creator: true, assignee: true, taskProject: true },
    });
  }

  async updateTask(taskId: string, dto: UpdateTaskDto) {
    return await this.prisma.task.update({
      where: { id: taskId },
      data: { ...dto },
    });
  }

  async createTask(data: {
    title: string;
    description?: string;
    groupId: string;
    taskProjectId?: string;
    status?: TaskStatus;
    assigneeId?: string;
    dueDate?: Date;
    creatorId?: string;
  }) {
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

  async deleteTask(taskId: string, operator?: { id: string; name?: string; source: string }) {
    return await this.prisma.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date(),
        lastOperatorId: operator?.id,
        lastOperatorName: operator?.name,
        lastOperatorSource: operator?.source,
      },
    });
  }
}
