import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { TaskGroupService } from "./task-group.service";

@Injectable()
export class TaskProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskGroupService: TaskGroupService,
  ) {}

  async getTaskProjectByProjectId(projectId: string) {
    return await this.prisma.taskProject.findUnique({
      where: { projectId },
    });
  }

  /**
   * Ensure the 1:1 companion TaskProject for a Nightwatch project.
   *
   * Every project owns its task space implicitly: there is no manual
   * linking step. The companion TaskGroup uses the synthetic chatId
   * `project:{projectId}`, so the chatId unique constraint carries the
   * 1:1 pairing and repeated calls stay idempotent without a schema
   * change. Name is set to the raw projectId for traceability; the web
   * UI never shows it.
   */
  async ensureTaskProjectForProject(projectId: string) {
    const existing = await this.getTaskProjectByProjectId(projectId);
    if (existing) return existing;

    const group = await this.taskGroupService.ensureGroupByChatId(
      `project:${projectId}`,
      "Project Tasks",
    );
    try {
      return await this.prisma.taskProject.create({
        data: { name: projectId, groupId: group.id, projectId },
      });
    } catch (e) {
      // Lost a concurrent-create race on the unique projectId: re-read.
      const created = await this.getTaskProjectByProjectId(projectId);
      if (created) return created;
      throw e;
    }
  }
}
