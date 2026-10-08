import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskStatus } from "@generated/prisma/enums";

/**
 * Identity source used for actors authenticated through the host's own
 * security module (JWT). Other sources (e.g. an IM platform) are supplied by
 * the host orchestration layer; this module never enumerates them.
 */
export const HOST_IDENTITY_SOURCE = "host";

export interface EnsureParticipantInput {
  identitySource: string;
  externalId: string;
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class TaskParticipantService {
  constructor(private readonly prisma: PrismaService) {}

  async listParticipants() {
    return await this.prisma.taskParticipant.findMany({
      select: {
        id: true,
        identitySource: true,
        externalId: true,
        name: true,
        avatarUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async getParticipantByIdentity(identitySource: string, externalId: string) {
    return await this.prisma.taskParticipant.findUnique({
      where: { identitySource_externalId: { identitySource, externalId } },
    });
  }

  /**
   * Idempotently resolve a participant for an external identity. A
   * participant is one identity: cross-source account merging is a host
   * orchestration concern and intentionally not modelled here.
   */
  async ensureParticipant(input: EnsureParticipantInput) {
    const existing = await this.getParticipantByIdentity(input.identitySource, input.externalId);
    if (existing) return existing;

    try {
      return await this.prisma.taskParticipant.create({
        data: {
          identitySource: input.identitySource,
          externalId: input.externalId,
          name: input.name || null,
          avatarUrl: input.avatarUrl || null,
        },
      });
    } catch (error) {
      // Lost a concurrent-create race on the composite unique: re-read.
      const created = await this.getParticipantByIdentity(input.identitySource, input.externalId);
      if (created) return created;
      throw error;
    }
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
          { createdTasks: { some: { projectId, deletedAt: null } } },
          { assignedTasks: { some: { projectId, deletedAt: null } } },
        ],
      },
      include: {
        assignedTasks: {
          where: { projectId, deletedAt: null },
          select: { status: true },
        },
        createdTasks: {
          where: { projectId, deletedAt: null },
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
