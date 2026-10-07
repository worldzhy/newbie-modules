import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";

@Injectable()
export class RequirementService {
  constructor(private readonly prisma: PrismaService) {}

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
      where: { id: requirementId },
      data: { score },
    });
  }
}
