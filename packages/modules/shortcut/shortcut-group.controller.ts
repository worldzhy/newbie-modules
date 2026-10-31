import { Controller, Post, Body, Get, Query, Patch, Delete, Param, BadRequestException } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreateShortcutGroupRequestDto,
  UpdateShortcutGroupRequestDto,
  ListShortcutGroupsRequestDto,
  ListShortcutGroupsResponseDto,
} from "./shortcut-group.dto";
import { ShortcutGroupEntity } from "./shortcut.entity";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

@ApiTags("Shortcut")
@ApiBearerAuth()
@Controller("shortcut-groups")
export class ShortcutGroupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ListShortcutGroupsResponseDto })
  async list(@Query() query: ListShortcutGroupsRequestDto) {
    const { page, pageSize, id, projectId } = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.ShortcutGroup,
      pagination: { page, pageSize },
      findManyArgs: { where: { id, projectId }, orderBy: { sort: "desc" } },
    });
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async create(@Body() body: CreateShortcutGroupRequestDto) {
    const { projectId, ...data } = body;
    await this.assertParentInProject(data.parentId, projectId);
    return await this.prisma.shortcutGroup.create({
      data: { ...data, project: { connect: { id: projectId } } },
    });
  }

  @Patch(":shortcutGroupId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async update(@Param("shortcutGroupId") shortcutGroupId: string, @Body() body: UpdateShortcutGroupRequestDto) {
    const id = Number(shortcutGroupId);
    if (body.parentId !== undefined) {
      // Re-parenting must stay inside the group's own project, and a group can
      // never be its own parent.
      const current = await this.prisma.shortcutGroup.findUniqueOrThrow({
        where: { id },
        select: { projectId: true },
      });
      if (body.parentId === id) throw new BadRequestException("A shortcut group cannot be its own parent.");
      await this.assertParentInProject(body.parentId, current.projectId);
    }
    return await this.prisma.shortcutGroup.update({ where: { id }, data: body });
  }

  @Delete(":shortcutGroupId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async delete(@Param("shortcutGroupId") shortcutGroupId: string) {
    return await this.prisma.shortcutGroup.delete({ where: { id: Number(shortcutGroupId) } });
  }

  /**
   * A parent id must reference an existing group in the same project;
   * `0` (or an absent parent) means a root group. Rejecting dangling or
   * cross-project parents here keeps the tree endpoint free of orphan nodes
   * instead of relying on it to silently drop them.
   */
  private async assertParentInProject(parentId: number | undefined, projectId: string): Promise<void> {
    if (parentId === undefined || parentId === 0) return;
    const parent = await this.prisma.shortcutGroup.findUnique({
      where: { id: parentId },
      select: { projectId: true },
    });
    if (!parent || parent.projectId !== projectId) {
      throw new BadRequestException("The parent group does not exist in this project.");
    }
  }
}
