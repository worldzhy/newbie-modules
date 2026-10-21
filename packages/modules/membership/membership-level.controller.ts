import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
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
  @ApiOperation({ summary: "List all membership levels" })
  @ApiOkResponse({ type: ListMembershipLevelsResponseDto })
  async listMembershipLevels() {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.MembershipLevel,
      pagination: { page: 0, pageSize: 1000 },
    });
  }

  @Post()
  @ApiOperation({ summary: "Create a new membership level" })
  @ApiCreatedResponse({ type: MembershipLevelResponseDto })
  async createMembershipLevel(@Body() body: CreateMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.create({ data: body });
  }

  @Patch(":id")
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
  @ApiOperation({ summary: "Delete a membership level" })
  @ApiOkResponse({ type: MembershipLevelResponseDto })
  async deleteMembershipLevel(@Param() params: GetMembershipLevelRequestDto) {
    return await this.prisma.membershipLevel.delete({ where: { id: params.id } });
  }
}
