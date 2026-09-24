import {Body, Controller, Delete, Get, Ip, Param, ParseIntPipe, Patch, Post, Query} from '@nestjs/common';
import {OrgMembership, Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ApiBearerAuth, ApiResponse, ApiTags} from '@nestjs/swagger';
import {
  CreateMembershipDto,
  ListMembershipsRequestDto,
  ListMembershipsResponseDto,
  UpdateMembershipDto,
} from './membership.dto';
import {MembershipService} from './membership.service';

@ApiTags('Organization / Membership')
@ApiBearerAuth()
@Controller('organizations/:organizationId/memberships')
export class MembershipController {
  constructor(
    private membershipService: MembershipService,
    private prisma: PrismaService
  ) {}

  /** Add a member to a team */
  @Post()
  async create(
    @Ip() ipAddress: string,
    @Param('organizationId') organizationId: string,
    @Body() data: CreateMembershipDto
  ): Promise<OrgMembership> {
    return this.membershipService.create({ipAddress, organizationId, ...data});
  }

  /** Get memberships for a team */
  @Get()
  @ApiResponse({
    type: ListMembershipsResponseDto,
    description: 'List of memberships for the organization',
  })
  async getAll(@Param('organizationId') organizationId: string, @Query() query: ListMembershipsRequestDto) {
    const {page, pageSize} = query;
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.OrgMembership,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {organizationId},
        orderBy: {id: 'desc'},
        include: {organization: true, user: {select: {email: true}}},
      },
    });
  }

  /** Get a membership for a team */
  @Get(':id')
  async get(
    @Param('organizationId') organizationId: string,
    @Param('id', ParseIntPipe) id: number
  ): Promise<OrgMembership> {
    return this.membershipService.get(organizationId, id);
  }

  /** Update a membership for a team */
  @Patch(':id')
  async update(
    @Body() data: UpdateMembershipDto,
    @Param('organizationId') organizationId: string,
    @Param('id', ParseIntPipe) id: number
  ): Promise<OrgMembership> {
    return this.membershipService.update(organizationId, id, data);
  }

  /** Remove a member from a team */
  @Delete(':id')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('id', ParseIntPipe) id: number
  ): Promise<OrgMembership> {
    return this.membershipService.delete(organizationId, id);
  }
}
