import {Injectable, Logger} from '@nestjs/common';
import {PrismaService} from '../../framework/prisma/prisma.service';
import {TaskStatus} from '@generated/prisma/enums';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

dayjs.extend(isoWeek);

// Re-export the Prisma-generated enum so callers can keep importing it from the service module.
export {TaskStatus};

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
  projectId?: string; // Optional project ID
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

  // --- User Association Management ---

  async getTaskUserByUserId(userId: string) {
    return await this.prisma.taskUser.findUnique({
      where: {userId},
    });
  }

  async listTaskUsers() {
    return await this.prisma.taskUser.findMany({
      select: {
        id: true,
        openId: true,
        userId: true,
        name: true,
        avatarUrl: true,
      },
      orderBy: {name: 'asc'},
    });
  }

  async listTaskUsersByProjectId(projectId: string) {
    const taskProject = await this.getTaskProjectByProjectId(projectId);
    if (!taskProject) {
      return [];
    }

    const taskProjectId = taskProject.id;
    const users = await this.prisma.taskUser.findMany({
      where: {
        OR: [
          {createdTasks: {some: {taskProjectId, deletedAt: null}}},
          {assignedTasks: {some: {taskProjectId, deletedAt: null}}},
        ],
      },
      include: {
        assignedTasks: {
          where: {taskProjectId, deletedAt: null},
          select: {status: true},
        },
        createdTasks: {
          where: {taskProjectId, deletedAt: null},
          select: {id: true},
        },
      },
      orderBy: {name: 'asc'},
    });

    const userIds = users.map(u => u.userId).filter(Boolean) as string[];
    let systemUserMap = new Map<string, any>();
    if (userIds.length > 0) {
      const systemUsers = await this.prisma.user.findMany({
        where: {id: {in: userIds}},
        select: {id: true, name: true, username: true, email: true},
      });
      systemUserMap = new Map(systemUsers.map(u => [u.id, u]));
    }

    return users.map(user => {
      const tasks = user.assignedTasks;
      const total = tasks.length;
      const completed = tasks.filter(t => t.status === TaskStatus.COMPLETED).length;
      const inProgress = tasks.filter(
        t => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED
      ).length;

      const systemUser = user.userId ? systemUserMap.get(user.userId) : null;

      return {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        email: systemUser?.email || null,
        systemUsername: systemUser?.name || systemUser?.username || null,
        taskStats: {total, completed, inProgress},
        createdAt: user.createdAt,
      };
    });
  }

  async getTaskProjectByProjectId(projectId: string) {
    return await this.prisma.taskProject.findUnique({
      where: {projectId},
    });
  }

  async listTaskProjects() {
    return await this.prisma.taskProject.findMany({
      select: {
        id: true,
        projectId: true,
        name: true,
        description: true,
        groupId: true,
      },
      orderBy: {name: 'asc'},
    });
  }

  async linkTaskProject(projectId: string, taskProjectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({
      where: {projectId},
    });
    if (existingLink && existingLink.id !== taskProjectId) {
      throw new Error('This project is already linked to a TaskProject. Please unlink first.');
    }

    const targetTaskProject = await this.prisma.taskProject.findUnique({
      where: {id: taskProjectId},
    });
    if (!targetTaskProject) {
      throw new Error('TaskProject not found.');
    }
    if (targetTaskProject.projectId && targetTaskProject.projectId !== projectId) {
      throw new Error('This TaskProject is already linked to another project.');
    }

    return await this.prisma.taskProject.update({
      where: {id: taskProjectId},
      data: {projectId},
    });
  }

  async unlinkTaskProject(projectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({
      where: {projectId},
    });
    if (!existingLink) {
      throw new Error('No TaskProject linked to this project.');
    }

    return await this.prisma.taskProject.update({
      where: {id: existingLink.id},
      data: {projectId: null},
    });
  }

  async linkTaskUser(userId: string, taskUserId: string) {
    // 检查该 nightwatch user 是否已经关联了某个 TaskUser
    const existingLink = await this.prisma.taskUser.findUnique({
      where: {userId},
    });
    if (existingLink) {
      throw new Error('This user is already linked to a TaskUser. Please unlink first.');
    }

    // 检查目标 TaskUser 是否已经被别人关联
    const targetTaskUser = await this.prisma.taskUser.findUnique({
      where: {id: taskUserId},
    });
    if (!targetTaskUser) {
      throw new Error('TaskUser not found.');
    }
    if (targetTaskUser.userId) {
      throw new Error('This TaskUser is already linked to another user.');
    }

    return await this.prisma.taskUser.update({
      where: {id: taskUserId},
      data: {userId},
    });
  }

  async unlinkTaskUser(userId: string) {
    const existingLink = await this.prisma.taskUser.findUnique({
      where: {userId},
    });
    if (!existingLink) {
      throw new Error('No TaskUser linked to this user.');
    }

    return await this.prisma.taskUser.update({
      where: {id: existingLink.id},
      data: {userId: null},
    });
  }

  // --- Group Management ---

  async createOrUpdateGroup(dto: CreateTaskGroupDto) {
    return await this.prisma.taskGroup.upsert({
      where: {chatId: dto.chatId},
      update: {name: dto.name, description: dto.description, projectId: dto.projectId},
      create: {chatId: dto.chatId, name: dto.name, description: dto.description, projectId: dto.projectId},
    });
  }

  async getGroupByChatId(chatId: string) {
    const normalizedChatId = this.normalizeChatId(chatId);
    if (!normalizedChatId) return null;
    return await this.prisma.taskGroup.findUnique({
      where: {chatId: normalizedChatId},
    });
  }

  async ensureGroupByChatId(chatId: string, name?: string) {
    const normalizedChatId = this.normalizeChatId(chatId);
    if (!normalizedChatId) {
      throw new Error('chatId is required');
    }

    const existing = await this.getGroupByChatId(normalizedChatId);
    if (existing) return existing;

    try {
      const groupName = (name || '').trim() || `Group ${normalizedChatId.slice(-4)}`;
      return await this.prisma.taskGroup.create({
        data: {
          chatId: normalizedChatId,
          name: groupName,
        },
      });
    } catch (e) {
      const created = await this.getGroupByChatId(normalizedChatId);
      if (created) return created;
      throw e;
    }
  }

  private normalizeChatId(chatId: string) {
    const trimmed = (chatId || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/^['"]+|['"]+$/g, '');
  }

  async listGroups() {
    return await this.prisma.taskGroup.findMany({
      include: {
        _count: {
          select: {tasks: {where: {deletedAt: null}}},
        },
      },
      orderBy: {updatedAt: 'desc'},
    });
  }

  async createRequirement(dto: {
    parentMessageId?: string;
    parentMessageContent?: string;
    skillId?: string;
    prompt?: string;
    groupId?: string;
  }) {
    return await this.prisma.requirement.create({
      data: {
        parentMessageId: dto.parentMessageId,
        parentMessageContent: dto.parentMessageContent,
        skillId: dto.skillId,
        prompt: dto.prompt,
        groupId: dto.groupId,
      },
    });
  }

  async updateRequirementScore(requirementId: number, score: number) {
    return await this.prisma.requirement.update({
      where: {id: requirementId},
      data: {score},
    });
  }

  // --- Project Management ---

  async createProject(groupId: string, name: string, description?: string) {
    return await this.prisma.taskProject.create({
      data: {
        name,
        description,
        groupId,
      },
    });
  }

  async getProjectByName(groupId: string, name: string) {
    return await this.prisma.taskProject.findFirst({
      where: {
        groupId,
        name: {
          contains: name,
          mode: 'insensitive',
        },
        deletedAt: null,
      },
    });
  }

  async listProjects(groupId: string) {
    return await this.prisma.taskProject.findMany({
      where: {
        groupId,
        deletedAt: null,
      },
      orderBy: {createdAt: 'desc'},
    });
  }

  async getProjectByNameOrId(groupId: string, identifier: string) {
    return await this.prisma.taskProject.findFirst({
      where: {
        groupId,
        deletedAt: null,
        OR: [{id: identifier}, {name: identifier}],
      },
    });
  }

  async updateProjectName(groupId: string, oldNameOrId: string, newName: string) {
    const project = await this.getProjectByNameOrId(groupId, oldNameOrId);
    if (!project) {
      throw new Error('Project not found');
    }

    return await this.prisma.taskProject.update({
      where: {id: project.id},
      data: {name: newName},
    });
  }

  // --- User Management ---

  async upsertUser(openId: string, name?: string, avatarUrl?: string) {
    return await this.prisma.taskUser.upsert({
      where: {openId},
      update: {
        name: name || undefined,
        avatarUrl: avatarUrl || undefined,
      },
      create: {
        openId,
        name: name || `User ${openId.slice(-4)}`,
        avatarUrl,
      },
    });
  }

  async getUserByOpenId(openId: string) {
    return await this.prisma.taskUser.findUnique({
      where: {openId},
    });
  }

  async getUserByName(name: string) {
    // If the name starts with @, remove it for searching
    const cleanName = name.replace(/^@/, '').trim();
    return await this.prisma.taskUser.findFirst({
      where: {
        name: {
          contains: cleanName,
          mode: 'insensitive',
        },
      },
    });
  }

  // --- Weekly Report Management ---

  async listWeeklyReports(groupId: string, skip?: number, take?: number) {
    const total = await this.prisma.weeklyReport.count({
      where: {groupId},
    });
    const records = await this.prisma.weeklyReport.findMany({
      where: {groupId},
      include: {user: true},
      orderBy: [{year: 'desc'}, {week: 'desc'}],
      skip,
      take,
    });
    return {records, total};
  }

  async upsertWeeklyReport(groupId: string, userId: string, content: string) {
    const now = dayjs();
    const year = now.year();
    const week = now.isoWeek();

    return await this.prisma.weeklyReport.upsert({
      where: {
        groupId_userId_year_week: {
          groupId,
          userId,
          year,
          week,
        },
      },
      update: {
        content,
      },
      create: {
        groupId,
        userId,
        year,
        week,
        content,
      },
    });
  }

  async getWeeklyReport(groupId: string, userId: string, weekOffset: number = 0) {
    const targetDate = dayjs().add(weekOffset, 'week');
    const year = targetDate.year();
    const week = targetDate.isoWeek();

    return await this.prisma.weeklyReport.findUnique({
      where: {
        groupId_userId_year_week: {
          groupId,
          userId,
          year,
          week,
        },
      },
      include: {
        user: true,
      },
    });
  }

  // --- Monthly Report Management ---

  async listMonthlyReports(projectId: string, skip?: number, take?: number) {
    const total = await this.prisma.monthlyReport.count({
      where: {projectId},
    });
    const records = await this.prisma.monthlyReport.findMany({
      where: {projectId},
      orderBy: [{year: 'desc'}, {month: 'desc'}],
      skip,
      take,
    });
    return {records, total};
  }

  async updateMonthlyReportContent(reportId: string, content: string) {
    return await this.prisma.monthlyReport.update({
      where: {id: reportId},
      data: {content},
    });
  }

  async upsertMonthlyReport(projectId: string, year: number, month: number, content: string) {
    return await this.prisma.monthlyReport.upsert({
      where: {
        projectId_year_month: {
          projectId,
          year,
          month,
        },
      },
      update: {
        content,
      },
      create: {
        projectId,
        year,
        month,
        content,
      },
    });
  }

  async getMonthlyReport(projectId: string, year: number, month: number) {
    return await this.prisma.monthlyReport.findUnique({
      where: {
        projectId_year_month: {
          projectId,
          year,
          month,
        },
      },
      include: {
        project: true,
      },
    });
  }

  async getTasksByProjectAndDateRange(projectId: string, startDate: Date, endDate: Date) {
    return await this.prisma.task.findMany({
      where: {
        taskProjectId: projectId,
        deletedAt: null,
        OR: [
          {
            createdAt: {
              gte: startDate,
              lt: endDate,
            },
          },
          {
            updatedAt: {
              gte: startDate,
              lt: endDate,
            },
          },
        ],
      },
      include: {
        assignee: true,
        creator: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async getAllProjects() {
    return await this.prisma.taskProject.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        group: true,
      },
    });
  }

  // --- Task Management ---

  async createTasks(
    chatId: string,
    userId: string | undefined,
    tasks: TaskItem[],
    operator?: {id: string; name?: string; source: string},
    requirementId?: number,
    taskProjectId?: string
  ) {
    try {
      // 1. Ensure Group exists or use Default
      let groupId: string;
      if (chatId) {
        let group = await this.prisma.taskGroup.findUnique({where: {chatId}});
        if (!group) {
          group = await this.prisma.taskGroup.create({
            data: {chatId, name: `Project Group ${chatId.slice(-4)}`},
          });
        }
        groupId = group.id;
      } else {
        const defaultGroup = await this.prisma.taskGroup.upsert({
          where: {chatId: 'DEFAULT_GROUP'},
          update: {},
          create: {chatId: 'DEFAULT_GROUP', name: 'Default Task Group'},
        });
        groupId = defaultGroup.id;
      }

      // 2. Ensure User exists (if userId is provided)
      let dbUserId: string | undefined;
      if (userId) {
        let user = await this.prisma.taskUser.findUnique({where: {openId: userId}});
        if (!user) {
          user = await this.prisma.taskUser.create({
            data: {openId: userId, name: `User ${userId.slice(-4)}`},
          });
        }
        dbUserId = user.id;
      }

      // 3. Create Tasks
      await this.prisma.task.createMany({
        data: tasks.map(t => ({
          title: t.title,
          description: t.description,
          status: t.status,
          groupId: groupId,
          creatorId: dbUserId,
          assigneeId: dbUserId, // 默认分配给当前操作者（拆解人）
          lastOperatorId: operator?.id,
          lastOperatorName: operator?.name,
          lastOperatorSource: operator?.source,
          requirementId: requirementId,
          taskProjectId: taskProjectId,
        })),
      });

      this.logger.log(`Tasks saved to DB for ${chatId || 'DEFAULT'}:`, tasks);
      const group = await this.prisma.taskGroup.findUnique({where: {id: groupId}});
      return {count: tasks.length, groupName: group?.name || 'Default Group'};
    } catch (error) {
      this.logger.error('Failed to save tasks to database', error);
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
    take?: number
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
        mode: 'insensitive', // PostgreSQL only, ignore if using SQLite/MySQL without support
      };
    }

    if (assigneeName) {
      const cleanName = assigneeName.replace(/^@/, '').trim();
      whereClause.assignee = {
        name: {
          contains: cleanName,
          mode: 'insensitive',
        },
      };
    }

    if (taskProjectId) {
      whereClause.taskProjectId = taskProjectId;
    }

    const total = await this.prisma.task.count({where: whereClause});

    const tasks = await this.prisma.task.findMany({
      where: whereClause,
      include: {creator: true, assignee: true, taskProject: true},
      orderBy: {createdAt: 'desc'},
      skip,
      take,
    });

    return {tasks, total};
  }

  async getTaskById(taskId: string) {
    return await this.prisma.task.findUnique({
      where: {id: taskId},
      include: {creator: true, assignee: true, taskProject: true},
    });
  }

  async updateTask(taskId: string, dto: UpdateTaskDto) {
    return await this.prisma.task.update({
      where: {id: taskId},
      data: {...dto},
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

  async deleteTask(taskId: string, operator?: {id: string; name?: string; source: string}) {
    return await this.prisma.task.update({
      where: {id: taskId},
      data: {
        deletedAt: new Date(),
        lastOperatorId: operator?.id,
        lastOperatorName: operator?.name,
        lastOperatorSource: operator?.source,
      },
    });
  }
}
