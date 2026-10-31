import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import {
  CreateMembershipLevelRequestDto,
  GetMembershipLevelRequestDto,
  ListMembershipLevelsResponseDto,
  MembershipLevelResponseDto,
  UpdateMembershipLevelRequestDto,
} from "./membership.dto";

@ApiTags("Membership / Level")
@ApiBearerAuth()
@Controller("memberships/levels")
export class MembershipLevelController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.MembershipLevel)
  @ApiOperation({ summary: "List all membership levels" })
  @ApiOkResponse({ type: ListMembershipLevelsResponseDto })
  async listMembershipLevels() {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MembershipLevel,
      pagination: { page: 0, pageSize: 1000 },
    });
  }

  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.MembershipLevel)
  @ApiOperation({ summary: "Create a new membership level" })
  @ApiCreatedResponse({ type: MembershipLevelResponseDto })
  async createMembershipLevel(@Body() body: CreateMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.create({ data: body });
  }

  @Patch(":id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.MembershipLevel)
  @ApiOperation({ summary: "Update an existing membership level" })
  @ApiOkResponse({ type: MembershipLevelResponseDto })
  async updateMembershipLevel(
    @Param() params: GetMembershipLevelRequestDto,
    @Body() body: UpdateMembershipLevelRequestDto,
  ) {
    return await this.prisma.membershipLevel.update({
      where: { id: params.id },
      data: body,
    });
  }

  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.MembershipLevel)
  @ApiOperation({ summary: "Delete a membership level" })
  @ApiOkResponse({ type: MembershipLevelResponseDto })
  async deleteMembershipLevel(@Param() params: GetMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.delete({ where: { id: params.id } });
  }
}
