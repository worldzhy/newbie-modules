import { Body, Controller, Delete, Get, Ip, Param, ParseIntPipe, Patch, Post, Query, Req } from "@nestjs/common";
import { OrgMembership, PermissionAction, Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequirePermission } from "@modules/security/authorization/require-permission.decorator";
import { UserRequest } from "@modules/security/security.interface";
import {
  CreateMembershipDto,
  ListMembershipsRequestDto,
  ListMembershipsResponseDto,
  UpdateMembershipDto,
} from "./membership.dto";
import { MembershipService } from "./membership.service";

@ApiTags("Organization / Membership")
@ApiBearerAuth()
@Controller("organizations/:organizationId/memberships")
export class MembershipController {
  constructor(
    private membershipService: MembershipService,
    private prisma: PrismaService,
  ) {}

  /** Add a member to a team */
  @Post()
  @RequirePermission(PermissionAction.Create, Prisma.ModelName.OrgMembership)
  @ApiCreatedResponse()
  async create(
    @Req() req: UserRequest,
    @Ip() ipAddress: string,
    @Param("organizationId") organizationId: string,
    @Body() data: CreateMembershipDto,
  ): Promise<OrgMembership> {
    return this.membershipService.create({ ipAddress, organizationId, actorId: req.user.userId, ...data });
  }

  /** Get memberships for a team */
  @Get()
  @RequirePermission(PermissionAction.List, Prisma.ModelName.OrgMembership)
  @ApiResponse({
    type: ListMembershipsResponseDto,
    description: "List of memberships for the organization",
  })
  async list(
    @Req() req: UserRequest,
    @Param("organizationId") organizationId: string,
    @Query() query: ListMembershipsRequestDto,
  ) {
    // The permission check proves a system-level grant; this proves the caller
    // actually belongs to the organization whose members are being listed.
    await this.membershipService.assertMember(organizationId, req.user.userId);
    const { page, pageSize } = query;
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.OrgMembership,
      pagination: { page, pageSize },
      findManyArgs: {
        where: { organizationId },
        orderBy: { id: "desc" },
        include: { organization: true, user: { select: { email: true } } },
      },
    });
  }

  /** Get a membership for a team */
  @Get(":id")
  @RequirePermission(PermissionAction.Get, Prisma.ModelName.OrgMembership)
  @ApiOkResponse()
  async get(
    @Req() req: UserRequest,
    @Param("organizationId") organizationId: string,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<OrgMembership> {
    return this.membershipService.get(organizationId, id, req.user.userId);
  }

  /** Update a membership for a team */
  @Patch(":id")
  @RequirePermission(PermissionAction.Update, Prisma.ModelName.OrgMembership)
  @ApiOkResponse()
  async update(
    @Req() req: UserRequest,
    @Body() data: UpdateMembershipDto,
    @Param("organizationId") organizationId: string,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<OrgMembership> {
    return this.membershipService.update(organizationId, id, data, req.user.userId);
  }

  /** Remove a member from a team */
  @Delete(":id")
  @RequirePermission(PermissionAction.Delete, Prisma.ModelName.OrgMembership)
  @ApiOkResponse()
  async remove(
    @Req() req: UserRequest,
    @Param("organizationId") organizationId: string,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<OrgMembership> {
    return this.membershipService.delete(organizationId, id, req.user.userId);
  }
}
