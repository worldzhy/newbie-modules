import {Injectable, NotFoundException} from '@nestjs/common';
import type {Prisma} from '@generated/prisma/client';
import {Organization} from '@generated/prisma/client';
import randomColor from 'randomcolor';
import {GROUP_NOT_FOUND} from '@devbie/newbie/exceptions/errors.constants';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Expose, expose} from '@microservices/account/helpers/expose';

@Injectable()
export class OrganizationService {
  constructor(private prisma: PrismaService) {}

  async create(ownerUserId: string, data: Prisma.OrganizationCreateInput) {
    let initials = data.name.trim().substring(0, 2).toUpperCase();
    if (data.name.includes(' '))
      initials = data.name
        .split(' ')
        .map(i => i.trim().substring(0, 1))
        .join('')
        .toUpperCase();
    data.profilePictureUrl =
      data.profilePictureUrl ??
      `https://ui-avatars.com/api/?name=${initials}&background=${randomColor({
        luminosity: 'light',
      }).replace('#', '')}&color=000000`;

    return this.prisma.organization.create({
      include: {memberships: {include: {organization: true}}},
      data: {
        ...data,
        memberships: {
          create: {role: 'OWNER', userId: ownerUserId},
        },
      },
    });
  }

  async getOrganizations(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.OrganizationWhereUniqueInput;
    where?: Prisma.OrganizationWhereInput;
    orderBy?: Prisma.OrganizationOrderByWithAggregationInput;
  }): Promise<Expose<Organization>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const organizations = await this.prisma.organization.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
      });
      return organizations.map(user => expose<Organization>(user));
    } catch (error) {
      return [];
    }
  }

  async getOrganization(
    id: string,
    {
      select,
      include,
    }: {
      select?: Record<string, boolean>;
      include?: Record<string, boolean>;
    }
  ): Promise<Expose<Organization>> {
    const organization = await this.prisma.organization.findUnique({
      where: {id},
      select,
      include,
    } as any);
    if (!organization) throw new NotFoundException(GROUP_NOT_FOUND);
    return expose<Organization>(organization);
  }

  async updateOrganization(id: string, data: Prisma.OrganizationUpdateInput): Promise<Expose<Organization>> {
    const testOrganization = await this.prisma.organization.findUnique({
      where: {id},
    });
    if (!testOrganization) throw new NotFoundException(GROUP_NOT_FOUND);
    const organization = await this.prisma.organization.update({
      where: {id},
      data,
    });
    return expose<Organization>(organization);
  }

  async replaceOrganization(id: string, data: Prisma.OrganizationCreateInput): Promise<Expose<Organization>> {
    const testOrganization = await this.prisma.organization.findUnique({
      where: {id},
    });
    if (!testOrganization) throw new NotFoundException(GROUP_NOT_FOUND);
    const organization = await this.prisma.organization.update({
      where: {id},
      data,
    });
    return expose<Organization>(organization);
  }

  async deleteOrganization(id: string): Promise<Expose<Organization>> {
    const testOrganization = await this.prisma.organization.findUnique({
      where: {id},
    });
    if (!testOrganization) throw new NotFoundException(GROUP_NOT_FOUND);
    await this.prisma.orgMembership.deleteMany({where: {organization: {id}}});
    const organization = await this.prisma.organization.delete({
      where: {id},
    });
    return expose<Organization>(organization);
  }
}
