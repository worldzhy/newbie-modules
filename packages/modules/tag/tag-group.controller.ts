import { Controller, Delete, Get, Patch, Post, Body, Param, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags, ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { TagGroup, Prisma, PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { CreateTagGroupDto, ListTagGroupsRequestDto, UpdateTagGroupDto } from "./tag.dto";

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
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.TagGroup)
  async createTagGroup(@Body() body: CreateTagGroupDto): Promise<TagGroup> {
    return await this.prisma.tagGroup.create({
      data: { ...body },
    });
  }

  @Get("")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.TagGroup)
  async list(@Query() query: ListTagGroupsRequestDto) {
    const { page, pageSize } = query;
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.TagGroup,
      pagination: { page, pageSize },
    });
  }

  @Get(":tagGroupId")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.TagGroup)
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
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.TagGroup)
  async updateTagGroup(
    @Param("tagGroupId") tagGroupId: number,
    @Body()
    body: UpdateTagGroupDto,
  ): Promise<TagGroup> {
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    return await this.prisma.tagGroup.update({
      where: { id: tagGroupId },
      data,
    });
  }

  @Delete(":tagGroupId")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.TagGroup)
  async deleteTagGroup(@Param("tagGroupId") tagGroupId: number): Promise<TagGroup> {
    // Detach all tags from the group before deleting it so the FK does not block.
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
