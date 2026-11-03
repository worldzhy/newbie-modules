import { Controller, Delete, Get, Patch, Post, Body, Param, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags, ApiBearerAuth, ApiBody } from "@nestjs/swagger";
import { Tag, Prisma, PermissionAction } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { CreateTagDto, ListTagsRequestDto, UpdateTagDto } from "./tag.dto";

/**
 * Sentinel id of the synthetic group holding groupless tags in the
 * `GET /tags/grouped` response. Part of the API contract: it never collides
 * with real TagGroup ids (autoincrement, always positive).
 */
export const UNGROUPED_TAG_GROUP_ID = -1;

@ApiTags("Tag")
@ApiBearerAuth()
@Controller("tags")
export class TagController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("grouped")
  @ApiOkResponse({ type: Object, isArray: true })
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Tag)
  async getGroupedTags() {
    const tagGroups = await this.prisma.tagGroup.findMany({
      select: {
        id: true,
        name: true,
        tags: { select: { id: true, name: true } },
      },
    });

    const tagsWithoutGroup = await this.prisma.tag.findMany({
      where: { groupId: null },
      select: { id: true, name: true },
    });

    tagGroups.push({
      id: UNGROUPED_TAG_GROUP_ID,
      name: "Ungrouped",
      tags: tagsWithoutGroup,
    });

    return tagGroups;
  }

  @Post("")
  @ApiCreatedResponse()
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: "1. Create",
        value: {
          name: "well-experienced",
          groupId: 1,
        },
      },
    },
  })
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Tag)
  async createTag(@Body() body: CreateTagDto): Promise<Tag> {
    return await this.prisma.tag.create({
      data: { ...body },
    });
  }

  @Get("")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Tag)
  async list(@Query() query: ListTagsRequestDto) {
    const { page, pageSize } = query;

    // [step 1] Construct where argument.
    let where: Prisma.TagWhereInput | undefined;
    const whereConditions: object[] = [];
    if (query.name) {
      const name = query.name.trim();
      if (name.length > 0) {
        whereConditions.push({ name: { contains: name, mode: "insensitive" } });
      }
    }

    if (whereConditions.length > 1) {
      where = { OR: whereConditions };
    } else if (whereConditions.length === 1) {
      where = whereConditions[0];
    } else {
      // where === undefined
    }

    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Tag,
      pagination: { page, pageSize },
      findManyArgs: { where },
    });
  }

  @Get(":tagId")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Tag)
  async getTag(@Param("tagId") tagId: number): Promise<Tag> {
    return await this.prisma.tag.findUniqueOrThrow({
      where: { id: tagId },
    });
  }

  @Patch(":tagId")
  @ApiOkResponse()
  @ApiBody({
    description: "",
    examples: {
      a: {
        summary: "1. Update",
        value: {
          name: "non-experienced",
          groupId: 1,
        },
      },
    },
  })
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Tag)
  async updateTag(
    @Param("tagId") tagId: number,
    @Body()
    body: UpdateTagDto,
  ): Promise<Tag> {
    // Strip undefined keys so Prisma only touches fields the caller actually sent.
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    return await this.prisma.tag.update({
      where: { id: tagId },
      data,
    });
  }

  @Delete(":tagId")
  @ApiOkResponse()
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Tag)
  async deleteTag(@Param("tagId") tagId: number): Promise<Tag> {
    return await this.prisma.tag.delete({
      where: { id: tagId },
    });
  }

  /* End */
}
