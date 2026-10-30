import { Controller, Delete, Get, Patch, Post, Body, Param, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import { Organization, PermissionAction, Prisma } from "@generated/prisma/client";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  CreateOrganizationRequestDto,
  ListOrganizationsRequestDto,
  UpdateOrganizationRequestDto,
} from "./organization.dto";

@ApiTags("Organization")
@ApiBearerAuth()
@Controller("organizations")
export class OrganizationController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("")
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.Organization)
  @ApiCreatedResponse()
  @ApiBody({
    description: "The 'name' is required in request body.",
    examples: {
      a: {
        summary: "1. Create",
        value: {
          name: "InceptionPad Inc",
        },
      },
    },
  })
  async createOrganization(@Body() body: CreateOrganizationRequestDto): Promise<Organization> {
    return await this.prisma.organization.create({
      data: body,
    });
  }

  @Get("")
  @RequirePermission(PermissionAction.List, Prisma.ModelName.Organization)
  @ApiOkResponse()
  async list(@Query() query: ListOrganizationsRequestDto) {
    const { page, pageSize } = query;

    // [step 1] Construct where argument.
    let where: Prisma.OrganizationWhereInput | undefined;
    if (query.name) {
      const name = query.name.trim();
      if (name.length > 0) {
        where = { name: { search: name } };
      }
    }

    // [step 2] Get organizations.
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Organization,
      pagination: { page, pageSize },
      findManyArgs: {
        orderBy: {
          _relevance: {
            fields: ["name"],
            search: "database",
            sort: "asc",
          },
        },
        where: where,
      },
    });
  }

  @Get(":organizationId")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.Organization)
  @ApiOkResponse()
  async getOrganization(@Param("organizationId") organizationId: string): Promise<Organization> {
    return await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
  }

  @Patch(":organizationId")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.Organization)
  @ApiOkResponse()
  @ApiBody({
    description: "",
    examples: {
      a: {
        summary: "1. Update name",
        value: {
          name: "InceptionPad Inc",
        },
      },
    },
  })
  async updateOrganization(
    @Param("organizationId") organizationId: string,
    @Body()
    body: UpdateOrganizationRequestDto,
  ): Promise<Organization> {
    return await this.prisma.organization.update({
      where: { id: organizationId },
      data: body,
    });
  }

  @Delete(":organizationId")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.Organization)
  @ApiOkResponse()
  async deleteOrganization(@Param("organizationId") organizationId: string): Promise<Organization> {
    return await this.prisma.organization.delete({
      where: { id: organizationId },
    });
  }

  /* End */
}
