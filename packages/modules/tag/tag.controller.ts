import {Controller, Delete, Get, Patch, Post, Body, Param, Query} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiBody} from '@nestjs/swagger';
import {Tag, Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

@ApiTags('Tag')
@ApiBearerAuth()
@Controller('tags')
export class TagController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('grouped')
  async getGroupedTags() {
    const tagGroups = await this.prisma.tagGroup.findMany({
      select: {
        id: true,
        name: true,
        tags: {select: {id: true, name: true}},
      },
    });

    const tagsWithoutGroup = await this.prisma.tag.findMany({
      where: {groupId: null},
      select: {id: true, name: true},
    });

    tagGroups.push({
      id: -1, // Use -1 to indicate no group
      name: '未分组',
      tags: tagsWithoutGroup,
    });

    return tagGroups;
  }

  @Post('')
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: '1. Create',
        value: {
          name: 'well-experienced',
          groupId: 1,
        },
      },
    },
  })
  async createTag(@Body() body: Prisma.TagUncheckedCreateInput): Promise<Tag> {
    return await this.prisma.tag.create({
      data: body,
    });
  }

  @Get('')
  async getTags(@Query('page') page: number, @Query('pageSize') pageSize: number, @Query('name') name?: string) {
    // [step 1] Construct where argument.
    let where: Prisma.TagWhereInput | undefined;
    const whereConditions: object[] = [];
    if (name) {
      name = name.trim();
      if (name.length > 0) {
        whereConditions.push({name: {contains: name, mode: 'insensitive'}});
      }
    }

    if (whereConditions.length > 1) {
      where = {OR: whereConditions};
    } else if (whereConditions.length === 1) {
      where = whereConditions[0];
    } else {
      // where === undefined
    }

    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Tag,
      pagination: {page, pageSize},
      findManyArgs: {where},
    });
  }

  @Get(':tagId')
  async getTag(@Param('tagId') tagId: number): Promise<Tag> {
    return await this.prisma.tag.findUniqueOrThrow({
      where: {id: tagId},
    });
  }

  @Patch(':tagId')
  @ApiBody({
    description: '',
    examples: {
      a: {
        summary: '1. Update',
        value: {
          name: 'non-experienced',
          groupId: 1,
        },
      },
    },
  })
  async updateTag(
    @Param('tagId') tagId: number,
    @Body()
    body: Prisma.TagUpdateInput
  ): Promise<Tag> {
    return await this.prisma.tag.update({
      where: {id: tagId},
      data: body,
    });
  }

  @Delete(':tagId')
  async deleteTag(@Param('tagId') tagId: number): Promise<Tag> {
    return await this.prisma.tag.delete({
      where: {id: tagId},
    });
  }

  /* End */
}
