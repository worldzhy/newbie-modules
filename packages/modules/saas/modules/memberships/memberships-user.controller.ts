import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {ApiTags, ApiResponse} from '@nestjs/swagger';
import {Membership, Prisma} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {Scopes} from '../auth/scope.decorator';
import {CreateTeamDto} from '../teams/teams.dto';
import {MembershipsService} from './memberships.service';
import {MembershipsListReqDto, MembershipsListResDto} from './memberships.dto';

@ApiTags('Users Memberships')
@Controller('users/:userId/memberships')
export class UserMembershipController {
  constructor(
    private membershipsService: MembershipsService,
    private prisma: PrismaService
  ) {}

  @Post()
  @Scopes('user-{userId}:write-membership-*')
  async create(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() data: CreateTeamDto
  ): Promise<Expose<Membership>> {
    return this.membershipsService.createUserMembership(userId, data);
  }

  /** Get memberships for a user */
  @Get()
  @ApiResponse({type: MembershipsListResDto})
  @Scopes('user-{userId}:read-membership-*')
  async getAll(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: MembershipsListReqDto
  ): Promise<MembershipsListResDto> {
    const {page, pageSize} = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Membership,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {userId},
        orderBy: {id: 'desc'},
        include: {team: true, user: true},
      },
    });

    result.records = result.records.map(user => expose<Membership>(user));
    return result;
  }

  /** Get a membership for a user */
  @Get(':id')
  @Scopes('user-{userId}:read-membership-{id}')
  async get(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Membership>> {
    return this.membershipsService.getUserMembership(userId, id);
  }

  /** Delete a membership for a user */
  @Delete(':id')
  @Scopes('user-{userId}:delete-membership-{id}')
  async remove(
    @Param('userId', ParseIntPipe) userId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Membership>> {
    return this.membershipsService.deleteUserMembership(userId, id);
  }
}
