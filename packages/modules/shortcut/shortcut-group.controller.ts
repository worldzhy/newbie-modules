import {Controller, Post, Body, Get, Query, Patch, Delete, Param} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiResponse} from '@nestjs/swagger';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {CommonGetByNumberIdRequestDto} from '@devbie/newbie/common.dto';
import {
  CreateShortcutGroupRequestDto,
  UpdateShortcutGroupRequestDto,
  ListShortcutGroupsRequestDto,
  ListShortcutGroupsResponseDto,
} from './shortcut-group.dto';
import {ShortcutGroupEntity} from './shortcut.entity';

@ApiTags('Shortcut')
@ApiBearerAuth()
@Controller('shortcut-groups')
export class ShortcutGroupController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiResponse({type: ListShortcutGroupsResponseDto})
  async list(@Query() query: ListShortcutGroupsRequestDto) {
    const {page, pageSize, id} = query;
    return this.prisma.findManyInManyPages({
      model: Prisma.ModelName.ShortcutGroup,
      pagination: {page, pageSize},
      findManyArgs: {where: {deletedAt: null, id}, orderBy: {sort: 'desc'}},
    });
  }

  @Post()
  @ApiResponse({type: ShortcutGroupEntity})
  async create(@Body() body: CreateShortcutGroupRequestDto) {
    return await this.prisma.shortcutGroup.create({data: body});
  }

  @Patch(':id')
  @ApiResponse({type: ShortcutGroupEntity})
  async update(@Param() params: CommonGetByNumberIdRequestDto, @Body() body: UpdateShortcutGroupRequestDto) {
    return await this.prisma.shortcutGroup.update({where: {id: Number(params.id)}, data: body});
  }

  @Delete(':id')
  @ApiResponse({type: ShortcutGroupEntity})
  async delete(@Param() params: CommonGetByNumberIdRequestDto) {
    return await this.prisma.shortcutGroup.delete({where: {id: Number(params.id)}});
  }
}
