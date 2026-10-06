import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";
import { Prisma } from "@generated/prisma/client";

export { TaskStatus };

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
}

export interface CreateTaskGroupDto {
  chatId: string;
  name?: string;
  description?: string;
}

export interface UpdateTaskDto {
  status?: TaskStatus;
  title?: string;
  description?: string;
  assigneeId?: string;
  dueDate?: Date;
}

export interface TaskOperationContext {
  operator?: { id: string; name?: string; source: string };
  source?: StatusSource;
}

export type StatusSource = "bot" | "api" | "user" | "unknown";

export interface CreateTasksInput {
  chatId: string;
  userId?: string;
  tasks: TaskItem[];
  operator?: { id: string; name?: string; source: string };
  requirementId?: number;
  taskProjectId?: string;
}

export interface ListTasksFilter {
  groupId: string;
  status?: TaskStatus;
  title?: string;
  assigneeName?: string;
  taskProjectId?: string;
  includeCompleted?: boolean;
  skip?: number;
  take?: number;
}

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --- User Association Management (alias for controller compatibility) ---

  async getTaskUserByUserId(userId: string) {
    return this.prisma.taskUser.findUnique({ where: { userId } });
  }

  async listTaskUsers() {
    return this.prisma.taskUser.findMany({
      select: { id: true, openId: true, userId: true, name: true, avatarUrl: true },
      orderBy: { name: "asc" },
    });
  }

  async linkTaskUser(userId: string, taskUserId: string) {
    const existingLink = await this.prisma.taskUser.findUnique({ where: { userId } });
    if (existingLink) {
      throw new Error("This user is already linked to a TaskUser. Please unlink first.");
    }
    const targetTaskUser = await this.prisma.taskUser.findUnique({ where: { id: taskUserId } });
    if (!targetTaskUser) {
      throw new Error("TaskUser not found.");
    }
    if (targetTaskUser.userId) {
      throw new Error("This TaskUser is already linked to another user.");
    }
    return this.prisma.taskUser.update({ where: { id: taskUserId }, data: { userId } });
  }

  async unlinkTaskUser(userId: string) {
    const existingLink = await this.prisma.taskUser.findUnique({ where: { userId } });
    if (!existingLink) {
      throw new Error("No TaskUser linked to this user.");
    }
    return this.prisma.taskUser.update({ where: { id: existingLink.id }, data: { userId: null } });
  }

  async listTaskProjects() {
    return this.prisma.taskProject.findMany({
      select: { id: true, projectId: true, name: true, description: true, groupId: true },
      orderBy: { name: "asc" },
    });
  }

  async linkTaskProject(projectId: string, taskProjectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({ where: { projectId } });
    if (existingLink && existingLink.id !== taskProjectId) {
      throw new Error("This project is already linked to a TaskProject. Please unlink first.");
    }
    const targetTaskProject = await this.prisma.taskProject.findUnique({ where: { id: taskProjectId } });
    if (!targetTaskProject) {
      throw new Error("TaskProject not found.");
    }
    if (targetTaskProject.projectId && targetTaskProject.projectId !== projectId) {
      throw new Error("This TaskProject is already linked to another project.");
    }
    return this.prisma.taskProject.update({ where: { id: taskProjectId }, data: { projectId } });
  }

  async unlinkTaskProject(projectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({ where: { projectId } });
    if (!existingLink) {
      throw new Error("No TaskProject linked to this project.");
    }
    return this.prisma.taskProject.update({ where: { id: existingLink.id }, data: { projectId: null } });
  }

  // --- User Association Management ---

  async linkTaskUserToSystemUser(taskUserId: string, systemUserId: string) {
    const taskUser = await this.prisma.taskUser.findUnique({ where: { id: taskUserId } });
    if (!taskUser) {
      throw new Error(`TaskUser with ID ${taskUserId} not found.`);
    }
    if (taskUser.userId && taskUser.userId !== systemUserId) {
      throw new Error(`TaskUser ${taskUserId} is already linked to another system user.`);
    }

    const existingLinkedTaskUser = await this.prisma.taskUser.findUnique({ where: { userId: systemUserId } });
    if (existingLinkedTaskUser && existingLinkedTaskUser.id !== taskUserId) {
      throw new Error(`System user ${systemUserId} is already linked to TaskUser ${existingLinkedTaskUser.id}.`);
    }

    return this.prisma.taskUser.update({
      where: { id: taskUserId },
      data: { userId: systemUserId },
    });
  }

  async unlinkTaskUserFromSystemUser(systemUserId: string) {
    const taskUser = await this.prisma.taskUser.findUnique({ where: { userId: systemUserId } });
    if (!taskUser) {
      return null;
    }

    return this.prisma.taskUser.update({
      where: { id: taskUser.id },
      data: { userId: null },
    });
  }

  async getLinkedTaskUser(systemUserId: string) {
    return this.prisma.taskUser.findUnique({
      where: { userId: systemUserId },
    });
  }

  // --- TaskProject Association Management ---

  async linkTaskProjectToSystemProject(taskProjectId: string, systemProjectId: string) {
    const taskProject = await this.prisma.taskProject.findUnique({ where: { id: taskProjectId } });
    if (!taskProject) {
      throw new Error(`TaskProject with ID ${taskProjectId} not found.`);
    }
    if (taskProject.projectId && taskProject.projectId !== systemProjectId) {
      throw new Error(`TaskProject ${taskProjectId} is already linked to another Nightwatch Project.`);
    }

    const existingLinkedTaskProject = await this.prisma.taskProject.findUnique({
      where: { projectId: systemProjectId },
    });
    if (existingLinkedTaskProject && existingLinkedTaskProject.id !== taskProjectId) {
      throw new Error(
        `Nightwatch Project ${systemProjectId} is already linked to TaskProject ${existingLinkedTaskProject.id}.`,
      );
    }

    return this.prisma.taskProject.update({
      where: { id: taskProjectId },
      data: { projectId: systemProjectId },
    });
  }

  async unlinkTaskProjectFromSystemProject(systemProjectId: string) {
    const taskProject = await this.prisma.taskProject.findUnique({ where: { projectId: systemProjectId } });
    if (!taskProject) {
      return null;
    }

    return this.prisma.taskProject.update({
      where: { id: taskProject.id },
      data: { projectId: null },
    });
  }

  async getLinkedTaskProjectBySystemProjectId(systemProjectId: string) {
    return this.prisma.taskProject.findUnique({
      where: { projectId: systemProjectId },
    });
  }

  // --- Group Management ---

  async createOrUpdateGroup(dto: CreateTaskGroupDto) {
    return this.prisma.taskGroup.upsert({
      where: { chatId: dto.chatId },
      update: { name: dto.name, description: dto.description },
      create: dto,
    });
  }

  async listGroups() {
    return this.prisma.taskGroup.findMany({
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null } } },
        },
      },
    });
  }

  // --- Project Management ---

  async listProjectsByGroupId(groupId: string) {
    return this.prisma.taskProject.findMany({
      where: { groupId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async createTaskProject(groupId: string, name: string, description?: string) {
    const existing = await this.prisma.taskProject.findFirst({
      where: { groupId, name, deletedAt: null },
    });
    if (existing) {
      throw new Error(`Project with name "${name}" already exists in this group.`);
    }

    return this.prisma.taskProject.create({
      data: {
        groupId,
        name,
        description,
      },
    });
  }

  async getTaskProjectByProjectId(projectId: string) {
    return this.prisma.taskProject.findFirst({
      where: { projectId, deletedAt: null },
    });
  }

  async getAllProjects() {
    return this.prisma.taskProject.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  }

  async findTaskProjectByNameFuzzy(name: string, groupId: string): Promise<{ id: string; name: string } | null> {
    const projects = await this.prisma.taskProject.findMany({
      where: {
        groupId,
        deletedAt: null,
        name: { contains: name, mode: "insensitive" },
      },
      take: 2,
    });
    if (projects.length === 1) {
      return projects[0];
    }
    return null;
  }

  async updateTaskProjectAssignment(taskIds: string[], taskProjectId: string) {
    const project = await this.prisma.taskProject.findUnique({ where: { id: taskProjectId } });
    if (!project) {
      throw new Error(`TaskProject with ID ${taskProjectId} not found.`);
    }

    await this.prisma.task.updateMany({
      where: { id: { in: taskIds }, deletedAt: null },
      data: { taskProjectId },
    });

    return { success: true, count: taskIds.length, projectName: project.name };
  }

  async getTaskProjectById(id: string) {
    return this.prisma.taskProject.findUnique({ where: { id } });
  }

  // --- Task CRUD ---

  async createTasks(input: CreateTasksInput) {
    const { chatId, userId, tasks, operator, requirementId, taskProjectId } = input;
    const effectiveChatId = chatId || "DEFAULT_GROUP";

    let group = await this.prisma.taskGroup.findUnique({
      where: { chatId: effectiveChatId },
    });

    if (!group) {
      group = await this.prisma.taskGroup.create({
        data: {
          chatId: effectiveChatId,
          name: effectiveChatId === "DEFAULT_GROUP" ? "Default Project Group" : `Group ${effectiveChatId}`,
        },
      });
    }

    let dbUserId: string | undefined;
    if (userId) {
      const taskUser = await this.upsertTaskUser(userId);
      dbUserId = taskUser.id;
    }

    const createdTasks = [];
    for (const item of tasks) {
      const task = await this.prisma.task.create({
        data: {
          title: item.title,
          description: item.description,
          status: item.status || TaskStatus.PENDING,
          groupId: group.id,
          creatorId: dbUserId,
          assigneeId: dbUserId,
          requirementId: requirementId,
          taskProjectId: taskProjectId,
          lastOperatorId: operator?.id,
          lastOperatorName: operator?.name,
          lastOperatorSource: operator?.source,
        },
      });
      createdTasks.push(task);
    }
    return { count: createdTasks.length, groupId: group.id, groupName: group.name };
  }

  async createRequirementAndTasks(
    parentMessageId: string,
    parentMessageContent: string,
    prompt: string,
    skillId: string | undefined,
    chatId: string,
    tasks: TaskItem[],
    userId?: string,
  ) {
    const group = await this.prisma.taskGroup.upsert({
      where: { chatId },
      update: {},
      create: { chatId, name: `Group ${chatId}` },
    });

    const requirement = await this.prisma.requirement.create({
      data: {
        parentMessageId,
        parentMessageContent,
        prompt,
        skillId,
        groupId: group.id,
      },
    });

    let dbUserId: string | undefined;
    if (userId) {
      const taskUser = await this.upsertTaskUser(userId);
      dbUserId = taskUser.id;
    }

    const createdTasks = [];
    for (const item of tasks) {
      const task = await this.prisma.task.create({
        data: {
          title: item.title,
          description: item.description,
          status: item.status || TaskStatus.PENDING,
          groupId: group.id,
          creatorId: dbUserId,
          assigneeId: dbUserId,
          requirementId: requirement.id,
        },
      });
      createdTasks.push(task);
    }

    return { requirement, count: createdTasks.length, groupId: group.id, groupName: group.name };
  }

  async updateRequirementScore(requirementId: number, score: number) {
    return this.prisma.requirement.update({
      where: { id: requirementId },
      data: { score },
    });
  }

  async upsertTaskUser(openId: string, name?: string, avatarUrl?: string) {
    return this.prisma.taskUser.upsert({
      where: { openId },
      update: { name, avatarUrl },
      create: { openId, name, avatarUrl },
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
    return this.prisma.task.create({
      data: {
        title: data.title,
        description: data.description,
        groupId: data.groupId,
        taskProjectId: data.taskProjectId,
        status: data.status || TaskStatus.PENDING,
        assigneeId: data.assigneeId,
        creatorId: data.creatorId,
        dueDate: data.dueDate,
      },
    });
  }

  async updateTaskStatus(id: string, status: TaskStatus, context?: TaskOperationContext) {
    return this.prisma.task.update({
      where: { id },
      data: {
        status,
        lastOperatorId: context?.operator?.id,
        lastOperatorName: context?.operator?.name,
        lastOperatorSource: context?.operator?.source,
      },
    });
  }

  async updateTask(id: string, dto: any) {
    return this.prisma.task.update({
      where: { id },
      data: dto,
    });
  }

  async deleteTask(id: string, operator?: { id: string; name?: string; source: string }) {
    return this.prisma.task.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        lastOperatorId: operator?.id,
        lastOperatorName: operator?.name,
        lastOperatorSource: operator?.source,
      },
    });
  }

  async getTasks(groupId: string) {
    return this.prisma.task.findMany({
      where: {
        groupId,
        deletedAt: null,
      },
      include: {
        creator: true,
        assignee: true,
        taskProject: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async countTasks(filter: ListTasksFilter): Promise<number> {
    const { groupId, status, title, assigneeName, taskProjectId, includeCompleted } = filter;

    const whereClause: Prisma.TaskWhereInput = {
      deletedAt: null,
      groupId,
    };

    if (!includeCompleted) {
      whereClause.status = { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] };
    }
    if (status) whereClause.status = status;
    if (title) whereClause.title = { contains: title, mode: "insensitive" };
    if (assigneeName) whereClause.assignee = { name: { contains: assigneeName, mode: "insensitive" } };
    if (taskProjectId) whereClause.taskProjectId = taskProjectId;

    return this.prisma.task.count({ where: whereClause });
  }

  async listTasks(filter: ListTasksFilter) {
    const { groupId, status, title, assigneeName, taskProjectId, includeCompleted, skip = 0, take = 10 } = filter;

    const whereClause: Prisma.TaskWhereInput = {
      deletedAt: null,
      groupId,
    };

    if (!includeCompleted) {
      whereClause.status = { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] };
    }
    if (status) whereClause.status = status;
    if (title) whereClause.title = { contains: title, mode: "insensitive" };
    if (assigneeName) whereClause.assignee = { name: { contains: assigneeName, mode: "insensitive" } };
    if (taskProjectId) whereClause.taskProjectId = taskProjectId;

    return this.prisma.task.findMany({
      where: whereClause,
      include: { creator: true, assignee: true, taskProject: true },
      orderBy: { createdAt: "asc" },
      skip,
      take,
    });
  }

  async listTaskUsersByProjectId(systemProjectId: string) {
    const taskProject = await this.prisma.taskProject.findFirst({
      where: { projectId: systemProjectId, deletedAt: null },
    });

    if (!taskProject) {
      return [];
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        taskProjectId: taskProject.id,
        deletedAt: null,
      },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    });

    const assigneeIds = tasks.map((t) => t.assigneeId).filter((id): id is string => !!id);

    if (assigneeIds.length === 0) {
      return [];
    }

    const taskUsers = await this.prisma.taskUser.findMany({
      where: { id: { in: assigneeIds } },
    });

    const systemUserIds = taskUsers.map((tu) => tu.userId).filter((id): id is string => !!id);
    const systemUsers = await this.prisma.user.findMany({
      where: { id: { in: systemUserIds } },
      select: { id: true, email: true, username: true },
    });
    const systemUserMap = new Map(systemUsers.map((su) => [su.id, su]));

    const usersWithStats = await Promise.all(
      taskUsers.map(async (user) => {
        const [total, completed, inProgress] = await Promise.all([
          this.prisma.task.count({
            where: {
              assigneeId: user.id,
              taskProjectId: taskProject.id,
              deletedAt: null,
              status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
            },
          }),
          this.prisma.task.count({
            where: {
              assigneeId: user.id,
              taskProjectId: taskProject.id,
              deletedAt: null,
              status: TaskStatus.COMPLETED,
            },
          }),
          this.prisma.task.count({
            where: {
              assigneeId: user.id,
              taskProjectId: taskProject.id,
              deletedAt: null,
              status: TaskStatus.DEVELOPING,
            },
          }),
        ]);

        const systemUser = user.userId ? systemUserMap.get(user.userId) : null;

        return {
          id: user.id,
          name: user.name,
          avatarUrl: user.avatarUrl,
          email: systemUser?.email || null,
          systemUsername: systemUser?.username || null,
          createdAt: user.createdAt,
          taskStats: { total, completed, inProgress },
        };
      }),
    );

    return usersWithStats;
  }
}
