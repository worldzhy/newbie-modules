import {Injectable, NotFoundException} from '@nestjs/common';
import type {Prisma} from '@prisma/client';
import {Team} from '@prisma/client';
import * as randomColor from 'randomcolor';
import {GROUP_NOT_FOUND} from '../../errors/errors.constants';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async createTeam(
    userId: number,
    data: Omit<Omit<Prisma.TeamCreateInput, 'team'>, 'user'>
  ) {
    let initials = data.name.trim().substr(0, 2).toUpperCase();
    if (data.name.includes(' '))
      initials = data.name
        .split(' ')
        .map(i => i.trim().substr(0, 1))
        .join('')
        .toUpperCase();
    data.profilePictureUrl =
      data.profilePictureUrl ??
      `https://ui-avatars.com/api/?name=${initials}&background=${randomColor({
        luminosity: 'light',
      }).replace('#', '')}&color=000000`;
    return this.prisma.team.create({
      include: {memberships: {include: {team: true}}},
      data: {
        ...data,
        memberships: {
          create: {role: 'OWNER', user: {connect: {id: userId}}},
        },
      },
    });
  }

  async getTeams(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.TeamWhereUniqueInput;
    where?: Prisma.TeamWhereInput;
    orderBy?: Prisma.TeamOrderByWithAggregationInput;
  }): Promise<Expose<Team>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const teams = await this.prisma.team.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      });
      return teams.map(user => expose<Team>(user));
    } catch (error) {
      return [];
    }
  }

  async getTeam(
    id: number,
    {
      select,
      include,
    }: {
      select?: Record<string, boolean>;
      include?: Record<string, boolean>;
    }
  ): Promise<Expose<Team>> {
    const team = await this.prisma.team.findUnique({
      where: {id},
      select,
      include,
    } as any);
    if (!team) throw new NotFoundException(GROUP_NOT_FOUND);
    return expose<Team>(team);
  }

  async updateTeam(
    id: number,
    data: Prisma.TeamUpdateInput
  ): Promise<Expose<Team>> {
    const testTeam = await this.prisma.team.findUnique({
      where: {id},
    });
    if (!testTeam) throw new NotFoundException(GROUP_NOT_FOUND);
    const team = await this.prisma.team.update({
      where: {id},
      data,
    });
    return expose<Team>(team);
  }

  async replaceTeam(
    id: number,
    data: Prisma.TeamCreateInput
  ): Promise<Expose<Team>> {
    const testTeam = await this.prisma.team.findUnique({
      where: {id},
    });
    if (!testTeam) throw new NotFoundException(GROUP_NOT_FOUND);
    const team = await this.prisma.team.update({
      where: {id},
      data,
    });
    return expose<Team>(team);
  }

  async deleteTeam(id: number): Promise<Expose<Team>> {
    const testTeam = await this.prisma.team.findUnique({
      where: {id},
    });
    if (!testTeam) throw new NotFoundException(GROUP_NOT_FOUND);
    await this.prisma.membership.deleteMany({where: {team: {id}}});
    const team = await this.prisma.team.delete({
      where: {id},
    });
    return expose<Team>(team);
  }
}
