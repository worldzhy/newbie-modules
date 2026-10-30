import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrgMembership, MembershipRole, Prisma } from "@generated/prisma/client";
import {
  CANNOT_DELETE_SOLE_MEMBER,
  CANNOT_DELETE_SOLE_OWNER,
  CANNOT_UPDATE_ROLE_SOLE_OWNER,
  MEMBERSHIP_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { AuthService } from "@modules/account/auth/auth.service";
import { AwsSesService } from "@modules/aws-ses/aws-ses.service";
import { isMembershipManager, isRoleAbove } from "./membership-role";

@Injectable()
export class MembershipService {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private ses: AwsSesService,
    private authService: AuthService,
  ) {}

  async create(params: {
    organizationId: string;
    ipAddress: string;
    email: string;
    role?: MembershipRole;
    actorId: string;
  }) {
    const { organizationId, ipAddress, email, role, actorId } = params;

    // Only an organization ADMIN/OWNER may invite members, and the invitation
    // may never grant a role ranked above the inviter.
    const actorRole = await this.requireMembership(organizationId, actorId, true);
    if (role) this.assertRoleNotAbove(actorRole, role, "grant");

    // Register user
    let user: (object & { id: string; name: string | null }) | null;
    user = await this.prisma.user.findFirst({
      where: { emails: { some: { email } } },
    });
    if (!user) {
      user = await this.authService.signup({
        ipAddress,
        userData: { email },
      });
    }

    // Create membership
    const membership = await this.prisma.orgMembership.create({
      data: {
        organization: { connect: { id: organizationId } },
        role: role,
        userId: user.id,
      },
      include: { organization: { select: { name: true } } },
    });

    // Send invitation email
    this.ses.sendEmailWithTemplate({
      toAddress: `"${user.name}" <${email}>`,
      template: {
        "organizations/invitation": {
          organizationName: membership.organization.name,
          link: `${this.config.get<string>("framework.app.frontendUrl")}/organization/${params.organizationId}`,
        },
      },
    });

    return membership;
  }

  /** Any organization member may read the membership list/details. */
  async assertMember(organizationId: string, actorId: string): Promise<void> {
    await this.requireMembership(organizationId, actorId, false);
  }

  async get(organizationId: string, id: number, actorId: string): Promise<OrgMembership> {
    await this.requireMembership(organizationId, actorId, false);
    const membership = await this.prisma.orgMembership.findUnique({
      where: { id },
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return membership;
  }

  async update(
    organizationId: string,
    id: number,
    data: Prisma.OrgMembershipUpdateInput,
    actorId: string,
  ): Promise<OrgMembership> {
    const actorRole = await this.requireMembership(organizationId, actorId, true);
    const testMembership = await this.prisma.orgMembership.findUnique({
      where: { id },
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    // A manager must never change a role ranked above their own.
    this.assertRoleNotAbove(actorRole, testMembership.role, "change");
    if (typeof data.role === "string") {
      this.assertRoleNotAbove(actorRole, data.role, "grant");
    }
    if (testMembership.role === MembershipRole.OWNER && data.role !== MembershipRole.OWNER) {
      const otherOwners = (
        await this.prisma.orgMembership.findMany({
          where: {
            organization: { id: organizationId },
            role: MembershipRole.OWNER,
          },
        })
      ).filter((i) => i.id !== id);
      if (!otherOwners.length) throw new BadRequestException(CANNOT_UPDATE_ROLE_SOLE_OWNER);
    }

    return await this.prisma.orgMembership.update({
      where: { id },
      data,
    });
  }

  async delete(organizationId: string, id: number, actorId: string): Promise<OrgMembership> {
    const actorRole = await this.requireMembership(organizationId, actorId, true);
    const testMembership = await this.prisma.orgMembership.findUnique({
      where: { id },
    });
    if (!testMembership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (testMembership.organizationId !== organizationId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    this.assertRoleNotAbove(actorRole, testMembership.role, "remove");
    await this.verifyDeleteMembership(testMembership.organizationId, id);

    return await this.prisma.orgMembership.delete({
      where: { id },
    });
  }

  /**
   * Reads the caller's role in the organization and fails closed when they are
   * not a member (or, for write routes, not a manager). A missing row is a hard
   * denial rather than a silent skip so a revoked membership cannot keep acting.
   */
  private async requireMembership(
    organizationId: string,
    actorId: string,
    requireManager: boolean,
  ): Promise<MembershipRole> {
    const membership = await this.prisma.orgMembership.findFirst({
      where: { organizationId, userId: actorId },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException("You are not a member of this organization.");
    }
    if (requireManager && !isMembershipManager(membership.role)) {
      throw new ForbiddenException("Only an organization ADMIN or OWNER can manage memberships.");
    }
    return membership.role;
  }

  private assertRoleNotAbove(operatorRole: MembershipRole, targetRole: string, verb: string): void {
    if (isRoleAbove(targetRole, operatorRole)) {
      throw new ForbiddenException(`You cannot ${verb} an organization role above your own.`);
    }
  }

  /** Verify whether a organization membership can be deleted */
  private async verifyDeleteMembership(organizationId: string, membershipId: number): Promise<void> {
    const memberships = await this.prisma.orgMembership.findMany({
      where: { organization: { id: organizationId } },
    });
    if (memberships.length === 1) throw new BadRequestException(CANNOT_DELETE_SOLE_MEMBER);
    const membership = await this.prisma.orgMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException(MEMBERSHIP_NOT_FOUND);
    if (membership.role === "OWNER" && memberships.filter((i) => i.role === "OWNER").length === 1)
      throw new BadRequestException(CANNOT_DELETE_SOLE_OWNER);
  }
}
