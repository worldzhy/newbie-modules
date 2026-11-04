import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  Patch,
  Delete,
  Param,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { PermissionAction, Prisma, ShortcutItemType } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
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

/**
 * A LINK item must store an absolute http(s) URL: the frontend opens its
 * content with `window.open`, so `javascript:`, `data:` or `file:` payloads
 * would become an XSS / local-file-read primitive (R6-10). The create DTO
 * enforces this for the submitted payload; the update path has to validate the
 * *merged* row because `type` can be changed without resending `content`.
 */
export function assertLinkContent(type: ShortcutItemType, content: string): void {
  if (type !== ShortcutItemType.LINK) return;
  try {
    const parsed = new URL(content);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return;
  } catch {
    // Not an absolute URL — fall through to the rejection below.
  }
  throw new BadRequestException("A LINK shortcut must store an http(s) URL");
}

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

  @Patch(":shortcutItemId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutItemEntity })
  async update(@Param("shortcutItemId") shortcutItemId: string, @Body() body: UpdateShortcutItemRequestDto) {
    const id = Number(shortcutItemId);
    const existing = await this.prisma.shortcutItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Shortcut item ${shortcutItemId} not found`);

    // Validate the merged row, not the patch: `type` may be omitted, and
    // switching TEXT -> LINK must not smuggle a `javascript:` payload past the
    // create-time DTO rule (R6-10).
    assertLinkContent(body.type ?? existing.type, body.content ?? existing.content);

    return await this.prisma.shortcutItem.update({ where: { id }, data: body });
  }

  @Delete(":shortcutItemId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ShortcutItem)
  @ApiResponse({ type: ShortcutItemEntity })
  async delete(@Param("shortcutItemId") shortcutItemId: string) {
    return await this.prisma.shortcutItem.delete({ where: { id: Number(shortcutItemId) } });
  }
}
