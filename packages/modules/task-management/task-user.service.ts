import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";

@Injectable()
export class TaskUserService {
  constructor(private readonly prisma: PrismaService) {}

  async getTaskUserByUserId(userId: string) {
    return await this.prisma.taskUser.findUnique({
      where: { userId },
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
      orderBy: { name: "asc" },
    });
  }

  async listTaskUsersByProjectId(projectId: string) {
    const taskProject = await this.prisma.taskProject.findUnique({
      where: { projectId },
    });
    if (!taskProject) {
      return [];
    }

    const taskProjectId = taskProject.id;
    const users = await this.prisma.taskUser.findMany({
      where: {
        OR: [
          { createdTasks: { some: { taskProjectId, deletedAt: null } } },
          { assignedTasks: { some: { taskProjectId, deletedAt: null } } },
        ],
      },
      include: {
        assignedTasks: {
          where: { taskProjectId, deletedAt: null },
          select: { status: true },
        },
        createdTasks: {
          where: { taskProjectId, deletedAt: null },
          select: { id: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const userIds = users.map((u) => u.userId).filter(Boolean) as string[];
    let systemUserMap = new Map<string, any>();
    if (userIds.length > 0) {
      const systemUsers = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      systemUserMap = new Map(systemUsers.map((u) => [u.id, u]));
    }

    return users.map((user) => {
      const tasks = user.assignedTasks;
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
      const inProgress = tasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      ).length;

      const systemUser = user.userId ? systemUserMap.get(user.userId) : null;

      return {
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        email: systemUser?.email || null,
        systemUsername: systemUser?.name || null,
        taskStats: { total, completed, inProgress },
        createdAt: user.createdAt,
      };
    });
  }

  async linkTaskUser(userId: string, taskUserId: string) {
    const existingLink = await this.prisma.taskUser.findUnique({
      where: { userId },
    });
    if (existingLink) {
      throw new Error("This user is already linked to a TaskUser. Please unlink first.");
    }

    const targetTaskUser = await this.prisma.taskUser.findUnique({
      where: { id: taskUserId },
    });
    if (!targetTaskUser) {
      throw new Error("TaskUser not found.");
    }
    if (targetTaskUser.userId) {
      throw new Error("This TaskUser is already linked to another user.");
    }

    return await this.prisma.taskUser.update({
      where: { id: taskUserId },
      data: { userId },
    });
  }

  async unlinkTaskUser(userId: string) {
    const existingLink = await this.prisma.taskUser.findUnique({
      where: { userId },
    });
    if (!existingLink) {
      throw new Error("No TaskUser linked to this user.");
    }

    return await this.prisma.taskUser.update({
      where: { id: existingLink.id },
      data: { userId: null },
    });
  }

  async upsertUser(openId: string, name?: string, avatarUrl?: string) {
    return await this.prisma.taskUser.upsert({
      where: { openId },
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
      where: { openId },
    });
  }

  async getUserByName(name: string) {
    const cleanName = name.replace(/^@/, "").trim();
    return await this.prisma.taskUser.findFirst({
      where: {
        name: {
          contains: cleanName,
          mode: "insensitive",
        },
      },
    });
  }
}
