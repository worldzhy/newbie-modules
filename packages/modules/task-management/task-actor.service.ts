import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ActorKind, TaskStatus } from "@generated/prisma/enums";

/** Identity of one actor: exactly one of `userId` / `crewmateId` must be set. */
export interface ActorIdentityInput {
  userId?: string;
  crewmateId?: string;
  displayName?: string;
  avatarUrl?: string;
}

@Injectable()
export class TaskActorService {
  constructor(private readonly prisma: PrismaService) {}

  /** List every actor. Project membership was retired in ADR-047. */
  async listActors() {
    return await this.prisma.taskActor.findMany({
      select: {
        id: true,
        kind: true,
        userId: true,
        crewmateId: true,
        displayName: true,
        avatarUrl: true,
      },
      orderBy: { displayName: "asc" },
    });
  }

  /** Look up a HUMAN actor by the host user it stands for. */
  async getActorByUserId(targetUserId: string) {
    return await this.prisma.taskActor.findFirst({
      where: { userId: targetUserId },
    });
  }

  /** Look up a CREWMATE actor by the crewmate it stands for. */
  async getActorByCrewmateId(targetCrewmateId: string) {
    return await this.prisma.taskActor.findFirst({
      where: { crewmateId: targetCrewmateId },
    });
  }

  /**
   * Get or create the actor for one identity. `userId` creates a HUMAN actor,
   * `crewmateId` a CREWMATE actor; supplying both or neither is a caller bug
   * and is rejected (ADR-003 D2: the two kinds are mutually exclusive).
   */
  async getOrCreateActor(input: ActorIdentityInput) {
    const userId = input.userId?.trim() || undefined;
    const crewmateId = input.crewmateId?.trim() || undefined;
    if ((userId ? 1 : 0) + (crewmateId ? 1 : 0) !== 1) {
      throw new BadRequestException("exactly one of userId or crewmateId is required");
    }

    const existing = userId
      ? await this.getActorByUserId(userId)
      : await this.getActorByCrewmateId(crewmateId as string);
    if (existing) return existing;

    try {
      return await this.prisma.taskActor.create({
        data: {
          kind: userId ? ActorKind.HUMAN : ActorKind.CREWMATE,
          userId: userId ?? null,
          crewmateId: crewmateId ?? null,
          displayName: input.displayName ?? null,
          avatarUrl: input.avatarUrl ?? null,
        },
      });
    } catch (error) {
      // Lost a concurrent-create race on the unique identity: re-read.
      if ((error as { code?: string }).code === "P2002") {
        const raced = userId
          ? await this.getActorByUserId(userId)
          : await this.getActorByCrewmateId(crewmateId as string);
        if (raced) return raced;
      }
      throw error;
    }
  }

  /** Resolve the HUMAN actor for a host user, snapshotting the display fields. */
  async getOrCreateHostActor(input: { userId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true, uiAvatarsUrl: true },
    });

    return await this.getOrCreateActor({
      userId: input.userId,
      ...(user?.name ? { displayName: user.name } : {}),
      ...(user?.uiAvatarsUrl ? { avatarUrl: user.uiAvatarsUrl } : {}),
    });
  }

  async getActorByDisplayName(name: string) {
    const cleanName = name.replace(/^@/, "").trim();
    return await this.prisma.taskActor.findFirst({
      where: {
        displayName: {
          contains: cleanName,
          mode: "insensitive",
        },
      },
    });
  }

  /** Actors that created or own tasks in a project, with per-actor task stats. */
  async listActorMembersByProjectId(projectId: string) {
    const actors = await this.prisma.taskActor.findMany({
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
      },
      orderBy: { displayName: "asc" },
    });

    return actors.map((actor) => {
      const tasks = actor.assignedTasks;
      const total = tasks.length;
      const completed = tasks.filter((task) => task.status === TaskStatus.COMPLETED).length;
      const inProgress = tasks.filter(
        (task) => task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.CANCELLED,
      ).length;

      return {
        id: actor.id,
        kind: actor.kind,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        taskStats: { total, completed, inProgress },
        createdAt: actor.createdAt,
      };
    });
  }
}
