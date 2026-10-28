import { Controller, Post, Body, Get, Query, Patch, Delete, Param } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiResponse } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { CommonGetByNumberIdRequestDto } from "@devbie/newbie/common.dto";
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
    const { page, pageSize, id } = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.ShortcutGroup,
      pagination: { page, pageSize },
      findManyArgs: { where: { id }, orderBy: { sort: "desc" } },
    });
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async create(@Body() body: CreateShortcutGroupRequestDto) {
    return await this.prisma.shortcutGroup.create({ data: body });
  }

  @Patch(":id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async update(@Param() params: CommonGetByNumberIdRequestDto, @Body() body: UpdateShortcutGroupRequestDto) {
    return await this.prisma.shortcutGroup.update({ where: { id: Number(params.id) }, data: body });
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.ShortcutGroup)
  @ApiResponse({ type: ShortcutGroupEntity })
  async delete(@Param() params: CommonGetByNumberIdRequestDto) {
    return await this.prisma.shortcutGroup.delete({ where: { id: Number(params.id) } });
  }
}
