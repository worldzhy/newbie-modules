import { Controller, Delete, Get, Patch, Post, Body, Param, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags, ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { TagGroup, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ListTagGroupsRequestDto } from "./tag.dto";

@ApiTags("Tag / Group")
@ApiBearerAuth()
@Controller("tag-groups")
export class TagGroupController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("")
  @ApiCreatedResponse()
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: "1. Create",
        value: { name: "Group 1" },
      },
    },
  })
  async createTagGroup(@Body() body: Prisma.TagGroupUncheckedCreateInput): Promise<TagGroup> {
    return await this.prisma.tagGroup.create({
      data: body,
    });
  }

  @Get("")
  @ApiOkResponse()
  async list(@Query() query: ListTagGroupsRequestDto) {
    const { page, pageSize } = query;
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.TagGroup,
      pagination: { page, pageSize },
    });
  }

  @Get(":tagGroupId")
  @ApiOkResponse()
  async getTagGroup(@Param("tagGroupId") tagGroupId: number): Promise<TagGroup> {
    return await this.prisma.tagGroup.findUniqueOrThrow({
      where: { id: tagGroupId },
    });
  }

  @Patch(":tagGroupId")
  @ApiOkResponse()
  @ApiBody({
    description: "",
    examples: {
      a: {
        summary: "1. Update",
        value: { name: "Group 2" },
      },
    },
  })
  async updateTagGroup(
    @Param("tagGroupId") tagGroupId: number,
    @Body()
    body: Prisma.TagGroupUpdateInput,
  ): Promise<TagGroup> {
    return await this.prisma.tagGroup.update({
      where: { id: tagGroupId },
      data: body,
    });
  }

  @Delete(":tagGroupId")
  @ApiOkResponse()
  async deleteTagGroup(@Param("tagGroupId") tagGroupId: number): Promise<TagGroup> {
    await this.prisma.tag.updateMany({
      where: { groupId: tagGroupId },
      data: { groupId: null },
    });

    return await this.prisma.tagGroup.delete({
      where: { id: tagGroupId },
    });
  }

  /* End */
}
