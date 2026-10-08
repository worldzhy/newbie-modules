import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class TaskSpaceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ensure the 1:1 companion TaskSpace for a Nightwatch project.
   *
   * Every project owns its task space implicitly: pairing is carried by the
   * unique projectId column, so repeated calls stay idempotent without a
   * linking step. The space name is optional and supplied by the caller from
   * the project name; this module never reads the host Project table.
   */
  async ensureSpaceForProject(projectId: string, name?: string) {
    const existing = await this.getSpaceByProjectId(projectId);
    if (existing) return existing;

    const spaceName = (name || "").trim() || null;
    try {
      return await this.prisma.taskSpace.create({
        data: { projectId, name: spaceName },
      });
    } catch (error) {
      // Lost a concurrent-create race on the unique projectId: re-read.
      const created = await this.getSpaceByProjectId(projectId);
      if (created) return created;
      throw error;
    }
  }

  async getSpaceByProjectId(projectId: string) {
    return await this.prisma.taskSpace.findUnique({
      where: { projectId },
    });
  }

  async listSpaces() {
    return await this.prisma.taskSpace.findMany({
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}
