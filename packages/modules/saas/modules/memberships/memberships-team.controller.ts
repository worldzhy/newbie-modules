import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {Membership, Prisma} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ApiTags, ApiResponse} from '@nestjs/swagger';
import {expose} from '../../helpers/expose';
import {Expose} from '../../helpers/interfaces';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {CreateTeamMembershipDto, UpdateMembershipDto} from './memberships.dto';
import {MembershipsService} from './memberships.service';
import {MembershipsListReqDto, MembershipsListResDto} from './memberships.dto';

@ApiTags('Users Memberships')
@Controller('teams/:teamId/memberships')
export class TeamMembershipController {
  constructor(
    private membershipsService: MembershipsService,
    private prisma: PrismaService
  ) {}

  /** Add a member to a team */
  @Post()
  @AuditLog('add-membership')
  @Scopes('team-{teamId}:write-membership-*')
  async create(
    @Ip() ip: string,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: CreateTeamMembershipDto
  ): Promise<Expose<Membership>> {
    return this.membershipsService.createTeamMembership(ip, teamId, data);
  }

  /** Get memberships for a team */
  @Get()
  @ApiResponse({
    type: MembershipsListResDto,
  })
  @Scopes('team-{teamId}:read-membership-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query() query: MembershipsListReqDto
  ): Promise<MembershipsListResDto> {
    const {page, pageSize} = query;
    const res = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Membership,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {teamId},
        orderBy: {id: 'desc'},
        include: {team: true, user: {include: {prefersEmail: true}}},
      },
    });
    res.records = res.records.map(user => expose<Membership>(user));
    return res;
  }

  /** Get a membership for a team */
  @Get(':id')
  @Scopes('team-{teamId}:read-membership-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Membership>> {
    return this.membershipsService.getTeamMembership(teamId, id);
  }

  /** Update a membership for a team */
  @Patch(':id')
  @AuditLog('update-membership')
  @Scopes('team-{teamId}:write-membership-{id}')
  async update(
    @Body() data: UpdateMembershipDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Membership>> {
    return this.membershipsService.updateTeamMembership(teamId, id, data);
  }

  /** Remove a member from a team */
  @Delete(':id')
  @AuditLog('delete-membership')
  @Scopes('team-{teamId}:delete-membership-{id}')
  async remove(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Membership>> {
    return this.membershipsService.deleteTeamMembership(teamId, id);
  }
}
