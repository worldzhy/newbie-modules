import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Membership, User} from '@prisma/client';
import type {Prisma} from '@prisma/client';
import {
  CANNOT_DELETE_SOLE_MEMBER,
  CANNOT_DELETE_SOLE_OWNER,
  CANNOT_UPDATE_ROLE_SOLE_OWNER,
  MEMBERSHIP_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from '../../errors/errors.constants';
import {safeEmail} from '../../helpers/safe-email';
import {Expose} from '../../helpers/interfaces';
import {expose} from '../../helpers/expose';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ApiKeysService} from '../api-keys/api-keys.service';
import {AuthService} from '../auth/auth.service';
import {TeamsService} from '../teams/teams.service';
import {CreateMembershipInput} from './memberships.interface';
import {generateRandomString} from '@devbie/newbie/utilities/random.util';
import {EmailService} from '@modules/notification/email/email.service';

@Injectable()
export class MembershipsService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private email: EmailService,
    private configService: ConfigService,
    private teamsService: TeamsService,
    private apiKeyService: ApiKeysService
  ) {}

  async createUserMembership(
    userId: number,
    data: Omit<Prisma.TeamCreateInput, 'id'>
  ) {
    let id: number | undefined = undefined;
    while (!id) {
      id = Number(`10${await generateRandomString(6, 'numeric')}`);
      const users = await this.prisma.user.findMany({where: {id}, take: 1});
      if (users.length) id = undefined;
    }
    const created = await this.teamsService.createTeam(userId, {
      ...data,
      id,
    });
    return created.memberships[0];
  }

  async getMemberships(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.MembershipWhereUniqueInput;
    where?: Prisma.MembershipWhereInput;
    orderBy?: Prisma.MembershipOrderByWithAggregationInput;
  }): Promise<Expose<Membership>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const memberships = await this.prisma.membership.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
        include: {team: true, user: true},
      });
      return memberships.map(user => expose<Membership>(user));
    } catch (error) {
      return [];
    }
  }

  async getUserMembership(
    userId: number,
    id: number
  ): Promise<Expose<Membership>> {
    const membership = await this.prisma.membership.findUnique({
      where: {id},
      include: {team: true},
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<Membership>(membership);
  }

  async getTeamMembership(
    teamId: number,
    id: number
  ): Promise<Expose<Membership>> {
    const membership = await this.prisma.membership.findUnique({
      where: {id},
      include: {user: true},
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<Membership>(membership);
  }

  async deleteUserMembership(
    userId: number,
    id: number
  ): Promise<Expose<Membership>> {
    const testMembership = await this.prisma.membership.findUnique({
      where: {id},
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.userId !== userId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    await this.verifyDeleteMembership(testMembership.teamId, id);
    const membership = await this.prisma.membership.delete({
      where: {id},
    });
    await this.apiKeyService.removeUnauthorizedScopesForUser(userId);
    return expose<Membership>(membership);
  }

  async updateTeamMembership(
    teamId: number,
    id: number,
    data: Prisma.MembershipUpdateInput
  ): Promise<Expose<Membership>> {
    const testMembership = await this.prisma.membership.findUnique({
      where: {id},
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    if (testMembership.role === 'OWNER' && data.role !== 'OWNER') {
      const otherOwners = (
        await this.prisma.membership.findMany({
          where: {team: {id: teamId}, role: 'OWNER'},
        })
      ).filter(i => i.id !== id);
      if (!otherOwners.length)
        throw new BadRequestException(CANNOT_UPDATE_ROLE_SOLE_OWNER);
    }
    const membership = await this.prisma.membership.update({
      where: {id},
      data,
      include: {user: true},
    });
    await this.apiKeyService.removeUnauthorizedScopesForUser(
      testMembership.userId
    );
    return expose<Membership>(membership);
  }

  async deleteTeamMembership(
    teamId: number,
    id: number
  ): Promise<Expose<Membership>> {
    const testMembership = await this.prisma.membership.findUnique({
      where: {id},
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.teamId !== teamId)
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    await this.verifyDeleteMembership(testMembership.teamId, id);
    const membership = await this.prisma.membership.delete({
      where: {id},
      include: {user: true},
    });
    await this.apiKeyService.removeUnauthorizedScopesForUser(
      testMembership.userId
    );
    return expose<Membership>(membership);
  }

  async createTeamMembership(
    ipAddress: string,
    teamId: number,
    data: CreateMembershipInput
  ) {
    const emailSafe = safeEmail(data.email);
    const userResult = await this.prisma.user.findFirst({
      where: {emails: {some: {emailSafe}}},
    });
    let user: Expose<User> | null = userResult
      ? expose<User>(userResult)
      : null;
    if (!user)
      user = await this.auth.register(ipAddress, {name: data.email, ...data});
    const result = await this.prisma.membership.create({
      data: {
        role: data.role,
        team: {connect: {id: teamId}},
        user: {connect: {id: user.id}},
      },
      include: {team: {select: {name: true}}},
    });
    this.email.sendWithTemplate({
      toAddress: `"${user.name}" <${data.email}>`,
      template: {
        'teams/invitation': {
          userName: user.name,
          teamName: result.team.name,
          link: `${this.configService.get<string>(
            'modules.app.frontendUrl'
          )}/groups/${teamId}`,
        },
      },
    });
    return expose<Membership>(result);
  }

  /** Verify whether a team membership can be deleted */
  private async verifyDeleteMembership(
    teamId: number,
    membershipId: number
  ): Promise<void> {
    const memberships = await this.prisma.membership.findMany({
      where: {team: {id: teamId}},
    });
    if (memberships.length === 1)
      throw new BadRequestException(CANNOT_DELETE_SOLE_MEMBER);
    const membership = await this.prisma.membership.findUnique({
      where: {id: membershipId},
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (
      membership.role === 'OWNER' &&
      memberships.filter(i => i.role === 'OWNER').length === 1
    )
      throw new BadRequestException(CANNOT_DELETE_SOLE_OWNER);
  }
}
