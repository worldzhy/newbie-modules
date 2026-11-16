import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";

export interface GetOrCreateParticipantInput {
  /** Host user this participant stands for; also the participant's identity. */
  userId: string;
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class TaskParticipantService {
  constructor(private readonly prisma: PrismaService) {}

  /** List every participant. Project membership was retired in ADR-047. */
  async listParticipants() {
    return await this.prisma.taskParticipant.findMany({
      select: {
        id: true,
        userId: true,
        name: true,
        avatarUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  /** Look up a participant by the host user it stands for. */
  async getParticipantByUserId(targetUserId: string) {
    return await this.prisma.taskParticipant.findFirst({
      where: { userId: targetUserId },
    });
  }

  async getOrCreateParticipant(input: GetOrCreateParticipantInput) {
    return await this.prisma.taskParticipant.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        name: input.name || null,
        avatarUrl: input.avatarUrl || null,
      },
      update: {},
    });
  }

  async getOrCreateHostParticipant(input: { userId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true, uiAvatarsUrl: true },
    });

    return await this.getOrCreateParticipant({
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
