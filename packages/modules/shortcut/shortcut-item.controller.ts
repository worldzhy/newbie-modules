import {Controller, Post, Body, Get, Query, Patch, Delete, Param} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiResponse} from '@nestjs/swagger';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {CommonGetByNumberIdRequestDto} from '@devbie/newbie/common.dto';
import {
  ListShortcutItemsRequestDto,
  ListShortcutItemsResponseDto,
  CreateShortcutItemRequestDto,
  UpdateShortcutItemRequestDto,
  ShortcutTreeResDto,
  ShortcutTreeRequestDto,
} from './shortcut-item.dto';
import {ShortcutItemEntity} from './shortcut.entity';

@ApiTags('Shortcut')
@ApiBearerAuth()
@Controller('shortcut-items')
export class ShortcutItemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tree')
  @ApiResponse({type: ShortcutTreeResDto, isArray: true})
  async tree(@Query() query: ShortcutTreeRequestDto) {
    const groups = await this.prisma.shortcutGroup.findMany({
      orderBy: {sort: 'desc'},
    });
    const items = await this.prisma.shortcutItem.findMany({
      orderBy: {sort: 'desc'},
    });

    const groupMap = {};

    groups.forEach(groupItem => {
      groupMap[groupItem.id] = {...groupItem, items: [], child: []};
    });
    items.forEach(itemItem => {
      if (groupMap[itemItem.groupId]) {
        groupMap[itemItem.groupId].items.push(itemItem);
      }
    });

    Object.keys(groupMap).forEach(groupId => {
      if (groupMap[groupId].parentId !== 0) {
        groupMap[groupMap[groupId].parentId].child.push(groupMap[groupId]);
      }
    });

    return Object.keys(groupMap)
      .map(groupId => groupMap[groupId])
      .filter(group => group.parentId === 0)
      .filter(group => {
        if (query.groupId) {
          return group.id === query.groupId;
        } else {
          return true;
        }
      });
  }

  @Get()
  @ApiResponse({type: ListShortcutItemsResponseDto})
  async list(@Query() query: ListShortcutItemsRequestDto) {
    const {page, pageSize, id, ...rest} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.ShortcutItem,
      pagination: {page, pageSize},
      findManyArgs: {where: {id, ...rest}, orderBy: {sort: 'desc'}},
    });
  }

  @Post()
  @ApiResponse({type: ShortcutItemEntity})
  async create(@Body() body: CreateShortcutItemRequestDto) {
    return await this.prisma.shortcutItem.create({data: body});
  }

  @Patch(':id')
  @ApiResponse({type: ShortcutItemEntity})
  async update(@Param() params: CommonGetByNumberIdRequestDto, @Body() body: UpdateShortcutItemRequestDto) {
    return await this.prisma.shortcutItem.update({where: {id: Number(params.id)}, data: body});
  }

  @Delete(':id')
  @ApiResponse({type: ShortcutItemEntity})
  async delete(@Param() params: CommonGetByNumberIdRequestDto) {
    return await this.prisma.shortcutItem.delete({where: {id: Number(params.id)}});
  }
}
