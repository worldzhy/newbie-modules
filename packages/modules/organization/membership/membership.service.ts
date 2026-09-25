import {BadRequestException, Injectable, NotFoundException, UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {OrgMembership, MembershipRole, Prisma} from '@generated/prisma/client';
import {
  CANNOT_DELETE_SOLE_MEMBER,
  CANNOT_DELETE_SOLE_OWNER,
  CANNOT_UPDATE_ROLE_SOLE_OWNER,
  MEMBERSHIP_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from '@devbie/newbie/exceptions/errors.constants';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {AuthService} from '@modules/account/auth/auth.service';
import {AwsSesService} from '@modules/aws-ses/aws-ses.service';

@Injectable()
export class MembershipService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private ses: AwsSesService,
    private authService: AuthService
  ) {}

  async create(params: {organizationId: string; ipAddress: string; email: string; role?: MembershipRole}) {
    const {organizationId, ipAddress, email, role} = params;

    // Register user
    let user: (object & {id: string; name: string | null}) | null;
    user = await this.prisma.user.findFirst({
      where: {emails: {some: {email}}},
    });
    if (!user) {
      user = await this.authService.signup({
        ipAddress,
        userData: {email},
      });
    }

    // Create membership
    const membership = await this.prisma.orgMembership.create({
      data: {
        organization: {connect: {id: organizationId}},
        role: role,
        userId: user.id,
      },
      include: {organization: {select: {name: true}}},
    });

    // Send invitation email
    this.ses.sendEmailWithTemplate({
      toAddress: `"${user.name}" <${email}>`,
      template: {
        'organizations/invitation': {
          organizationName: membership.organization.name,
          link: `${this.config.get<string>('framework.app.frontendUrl')}/organization/${params.organizationId}`,
        },
      },
    });

    return membership;
  }

  async get(organizationId: string, id: number): Promise<OrgMembership> {
    const membership = await this.prisma.orgMembership.findUnique({
      where: {id},
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return membership;
  }

  async update(organizationId: string, id: number, data: Prisma.OrgMembershipUpdateInput): Promise<OrgMembership> {
    const testMembership = await this.prisma.orgMembership.findUnique({
      where: {id},
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    if (testMembership.role === MembershipRole.OWNER && data.role !== MembershipRole.OWNER) {
      const otherOwners = (
        await this.prisma.orgMembership.findMany({
          where: {
            organization: {id: organizationId},
            role: MembershipRole.OWNER,
          },
        })
      ).filter(i => i.id !== id);
      if (!otherOwners.length) throw new BadRequestException(CANNOT_UPDATE_ROLE_SOLE_OWNER);
    }

    return await this.prisma.orgMembership.update({
      where: {id},
      data,
    });
  }

  async delete(organizationId: string, id: number): Promise<OrgMembership> {
    const testMembership = await this.prisma.orgMembership.findUnique({
      where: {id},
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    await this.verifyDeleteMembership(testMembership.organizationId, id);

    return await this.prisma.orgMembership.delete({
      where: {id},
    });
  }

  /** Verify whether a organization membership can be deleted */
  private async verifyDeleteMembership(organizationId: string, membershipId: number): Promise<void> {
    const memberships = await this.prisma.orgMembership.findMany({
      where: {organization: {id: organizationId}},
    });
    if (memberships.length === 1) throw new BadRequestException(CANNOT_DELETE_SOLE_MEMBER);
    const membership = await this.prisma.orgMembership.findUnique({
      where: {id: membershipId},
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.role === 'OWNER' && memberships.filter(i => i.role === 'OWNER').length === 1)
      throw new BadRequestException(CANNOT_DELETE_SOLE_OWNER);
  }
}
