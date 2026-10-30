import { Controller, Post, Body, Get, Query, Patch, Delete, Param } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { CommonGetByNumberIdRequestDto } from "@devbie/newbie/common.dto";
import {
  ListShortcutItemsRequestDto,
  ListShortcutItemsResponseDto,
  CreateShortcutItemRequestDto,
  UpdateShortcutItemRequestDto,
  ShortcutTreeResDto,
  ShortcutTreeRequestDto,
} from "./shortcut-item.dto";
import { ShortcutItemEntity } from "./shortcut.entity";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";

@ApiTags("Shortcut")
@ApiBearerAuth()
@Controller("shortcut-items")
export class ShortcutItemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("tree")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutTreeResDto, isArray: true })
  async tree(@Query() query: ShortcutTreeRequestDto) {
    const groups = await this.prisma.shortcutGroup.findMany({
      where: { projectId: query.projectId },
      orderBy: { sort: "desc" },
    });
    const items = await this.prisma.shortcutItem.findMany({
      orderBy: { sort: "desc" },
    });

    const groupMap = {};

    groups.forEach((groupItem) => {
      groupMap[groupItem.id] = { ...groupItem, items: [], child: [] };
    });
    items.forEach((itemItem) => {
      if (groupMap[itemItem.groupId]) {
        groupMap[itemItem.groupId].items.push(itemItem);
      }
    });

    Object.keys(groupMap).forEach((groupId) => {
      const parent = groupMap[groupMap[groupId].parentId];
      // A dangling parentId (group deleted or belonging to another project)
      // must not crash the tree endpoint.
      if (groupMap[groupId].parentId !== 0 && parent) {
        parent.child.push(groupMap[groupId]);
      }
    });

    return Object.keys(groupMap)
      .map((groupId) => groupMap[groupId])
      .filter((group) => group.parentId === 0)
      .filter((group) => {
        if (query.groupId) {
          return group.id === query.groupId;
        } else {
          return true;
        }
      });
  }

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ListShortcutItemsResponseDto })
  async list(@Query() query: ListShortcutItemsRequestDto) {
    const { page, pageSize, id, projectId, ...rest } = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.ShortcutItem,
      pagination: { page, pageSize },
      findManyArgs: {
        where: { id, group: { projectId }, ...rest },
        orderBy: { sort: "desc" },
      },
    });
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutItemEntity })
  async create(@Body() body: CreateShortcutItemRequestDto) {
    return await this.prisma.shortcutItem.create({ data: body });
  }

  @Patch(":id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutItemEntity })
  async update(@Param() params: CommonGetByNumberIdRequestDto, @Body() body: UpdateShortcutItemRequestDto) {
    return await this.prisma.shortcutItem.update({ where: { id: Number(params.id) }, data: body });
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutItemEntity })
  async delete(@Param() params: CommonGetByNumberIdRequestDto) {
    return await this.prisma.shortcutItem.delete({ where: { id: Number(params.id) } });
  }
}
