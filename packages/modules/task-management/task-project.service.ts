import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class TaskProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async getTaskProjectByProjectId(projectId: string) {
    return await this.prisma.taskProject.findUnique({
      where: { projectId },
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
      orderBy: { name: "asc" },
    });
  }

  async linkTaskProject(projectId: string, taskProjectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({
      where: { projectId },
    });
    if (existingLink && existingLink.id !== taskProjectId) {
      throw new Error("This project is already linked to a TaskProject. Please unlink first.");
    }

    const targetTaskProject = await this.prisma.taskProject.findUnique({
      where: { id: taskProjectId },
    });
    if (!targetTaskProject) {
      throw new Error("TaskProject not found.");
    }
    if (targetTaskProject.projectId && targetTaskProject.projectId !== projectId) {
      throw new Error("This TaskProject is already linked to another project.");
    }

    return await this.prisma.taskProject.update({
      where: { id: taskProjectId },
      data: { projectId },
    });
  }

  async unlinkTaskProject(projectId: string) {
    const existingLink = await this.prisma.taskProject.findUnique({
      where: { projectId },
    });
    if (!existingLink) {
      throw new Error("No TaskProject linked to this project.");
    }

    return await this.prisma.taskProject.update({
      where: { id: existingLink.id },
      data: { projectId: null },
    });
  }

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
          mode: "insensitive",
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
      orderBy: { createdAt: "desc" },
    });
  }

  async getProjectByNameOrId(groupId: string, identifier: string) {
    return await this.prisma.taskProject.findFirst({
      where: {
        groupId,
        deletedAt: null,
        OR: [{ id: identifier }, { name: identifier }],
      },
    });
  }

  async updateProjectName(groupId: string, oldNameOrId: string, newName: string) {
    const project = await this.getProjectByNameOrId(groupId, oldNameOrId);
    if (!project) {
      throw new Error("Project not found");
    }

    return await this.prisma.taskProject.update({
      where: { id: project.id },
      data: { name: newName },
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
}
