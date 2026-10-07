import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

export interface CreateTaskGroupDto {
  chatId: string;
  name?: string;
  description?: string;
}

@Injectable()
export class TaskGroupService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrUpdateGroup(dto: CreateTaskGroupDto) {
    return await this.prisma.taskGroup.upsert({
      where: { chatId: dto.chatId },
      update: { name: dto.name, description: dto.description },
      create: { chatId: dto.chatId, name: dto.name, description: dto.description },
    });
  }

  async getGroupByChatId(chatId: string) {
    const normalizedChatId = this.normalizeChatId(chatId);
    if (!normalizedChatId) return null;
    return await this.prisma.taskGroup.findUnique({
      where: { chatId: normalizedChatId },
    });
  }

  async ensureGroupByChatId(chatId: string, name?: string) {
    const normalizedChatId = this.normalizeChatId(chatId);
    if (!normalizedChatId) {
      throw new Error("chatId is required");
    }

    const existing = await this.getGroupByChatId(normalizedChatId);
    if (existing) return existing;

    try {
      const groupName = (name || "").trim() || `Group ${normalizedChatId.slice(-4)}`;
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
    const trimmed = (chatId || "").trim();
    if (!trimmed) return "";
    return trimmed.replace(/^['"]+|['"]+$/g, "");
  }

  async listGroups() {
    return await this.prisma.taskGroup.findMany({
      include: {
        _count: {
          select: { tasks: { where: { deletedAt: null } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}
