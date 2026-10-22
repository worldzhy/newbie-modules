import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";

export interface EnsureParticipantInput {
  externalId: string;
  name?: string;
  avatarUrl?: string;
  /** Host user this participant stands for; enables the User FK and self-lookup. */
  userId?: string;
}

@Injectable()
export class TaskParticipantService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List participants visible to one user: herself plus anyone who created or
   * was assigned a task inside a project she belongs to.
   */
  async listParticipants(userId: string) {
    return await this.prisma.taskParticipant.findMany({
      where: {
        OR: [
          { userId },
          { createdTasks: { some: { space: { project: { members: { some: { userId } } } } } } },
          { assignedTasks: { some: { space: { project: { members: { some: { userId } } } } } } },
        ],
      },
      select: {
        id: true,
        externalId: true,
        name: true,
        avatarUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  /** Look up a participant by external ID, restricted to the requester's reach. */
  async getParticipantByExternalId(externalId: string, requesterUserId?: string) {
    if (!requesterUserId) {
      return await this.prisma.taskParticipant.findUnique({ where: { externalId } });
    }
    return await this.prisma.taskParticipant.findFirst({
      where: {
        externalId,
        OR: [
          { userId: requesterUserId },
          { createdTasks: { some: { space: { project: { members: { some: { userId: requesterUserId } } } } } } },
          { assignedTasks: { some: { space: { project: { members: { some: { userId: requesterUserId } } } } } } },
        ],
      },
    });
  }

  /** Internal lookup used for participant provisioning; no access filtering. */
  private async findByExternalId(externalId: string) {
    return await this.prisma.taskParticipant.findUnique({ where: { externalId } });
  }

  async ensureParticipant(input: EnsureParticipantInput) {
    const existing = await this.findByExternalId(input.externalId);
    if (existing) {
      // Backfill the host user link for participants created before the FK existed.
      if (input.userId && !existing.userId) {
        return await this.prisma.taskParticipant.update({
          where: { id: existing.id },
          data: { userId: input.userId },
        });
      }
      return existing;
    }

    try {
      return await this.prisma.taskParticipant.create({
        data: {
          externalId: input.externalId,
          name: input.name || null,
          avatarUrl: input.avatarUrl || null,
          ...(input.userId ? { userId: input.userId } : {}),
        },
      });
    } catch (error) {
      const created = await this.findByExternalId(input.externalId);
      if (created) return created;
      throw error;
    }
  }

  async ensureHostParticipant(input: { userId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true, uiAvatarsUrl: true },
    });

    return await this.ensureParticipant({
      externalId: input.userId,
      userId: input.userId,
      ...(user?.name ? { name: user.name } : {}),
      ...(user?.uiAvatarsUrl ? { avatarUrl: user.uiAvatarsUrl } : {}),
    });
  }

  async getParticipantByName(name: string) {
    const cleanName = name.replace(/^@/, "").trim();
    return await this.prisma.taskParticipant.findFirst({
      where: {
        name: {
          contains: cleanName,
          mode: "insensitive",
        },
      },
    });
  }

  async listParticipantsByProjectId(projectId: string) {
    const participants = await this.prisma.taskParticipant.findMany({
      where: {
        OR: [
          { createdTasks: { some: { space: { projectId }, deletedAt: null } } },
          { assignedTasks: { some: { space: { projectId }, deletedAt: null } } },
        ],
      },
      include: {
        assignedTasks: {
          where: { space: { projectId }, deletedAt: null },
          select: { status: true },
        },
        createdTasks: {
          where: { space: { projectId }, deletedAt: null },
          select: { id: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return participants.map((participant) => {
      const tasks = participant.assignedTasks;
      const total = tasks.length;
      const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
      const inProgress = tasks.filter(
        (t) => t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.CANCELLED,
      ).length;

      return {
        id: participant.id,
        name: participant.name,
        avatarUrl: participant.avatarUrl,
        taskStats: { total, completed, inProgress },
        createdAt: participant.createdAt,
      };
    });
  }
}
