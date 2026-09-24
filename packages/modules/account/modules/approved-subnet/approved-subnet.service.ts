import {Injectable, NotFoundException, UnauthorizedException} from '@nestjs/common';
import type {Prisma} from '@generated/prisma/client';
import {ApprovedSubnet} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import anonymize from 'ip-anonymize';
import {APPROVED_SUBNET_NOT_FOUND, UNAUTHORIZED_RESOURCE} from '@devbie/newbie/exceptions/errors.constants';
import {Expose, expose} from '../../helpers/expose';
import {GeolocationService} from '../../helpers/geolocation.service';
import {compareHash, generateHash} from '@devbie/newbie/utilities/common.util';

@Injectable()
export class ApprovedSubnetService {
  constructor(
    private prisma: PrismaService,
    private geolocationService: GeolocationService
  ) {}

  async getApprovedSubnets(
    userId: string,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApprovedSubnetWhereUniqueInput;
      where?: Prisma.ApprovedSubnetWhereInput;
      orderBy?: Prisma.ApprovedSubnetOrderByWithAggregationInput;
    }
  ): Promise<Expose<ApprovedSubnet>[]> {
    const {skip, take, cursor, where, orderBy} = params;
    try {
      const ApprovedSubnet = await this.prisma.approvedSubnet.findMany({
        skip,
        take,
        cursor,
        where: {...where, user: {id: userId}},
        orderBy,
      });
      return ApprovedSubnet.map(user => expose<ApprovedSubnet>(user));
    } catch (error) {
      return [];
    }
  }

  async getApprovedSubnet(userId: string, id: number): Promise<Expose<ApprovedSubnet>> {
    const ApprovedSubnet = await this.prisma.approvedSubnet.findUnique({
      where: {id},
    });
    if (!ApprovedSubnet) throw new NotFoundException(APPROVED_SUBNET_NOT_FOUND);
    if (ApprovedSubnet.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    if (!ApprovedSubnet) throw new NotFoundException(APPROVED_SUBNET_NOT_FOUND);
    return expose<ApprovedSubnet>(ApprovedSubnet);
  }

  async deleteApprovedSubnet(userId: string, id: number): Promise<Expose<ApprovedSubnet>> {
    const testApprovedSubnet = await this.prisma.approvedSubnet.findUnique({
      where: {id},
    });
    if (!testApprovedSubnet) throw new NotFoundException(APPROVED_SUBNET_NOT_FOUND);
    if (testApprovedSubnet.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const ApprovedSubnet = await this.prisma.approvedSubnet.delete({
      where: {id},
    });
    return expose<ApprovedSubnet>(ApprovedSubnet);
  }

  async approveNewSubnet(userId: string, ipAddress: string) {
    const subnet = await generateHash(anonymize(ipAddress));
    const location = await this.geolocationService.getLocation(ipAddress);
    const approved = await this.prisma.approvedSubnet.create({
      data: {
        user: {connect: {id: userId}},
        subnet,
        city: location?.city?.names?.en,
        region: location?.subdivisions?.pop()?.names?.en,
        timezone: location?.location?.time_zone,
        countryCode: location?.country?.iso_code,
      },
    });
    return expose<ApprovedSubnet>(approved);
  }

  /**
   * Upsert a new subnet
   * If this subnet already exists, skip; otherwise add it
   */
  async upsertNewSubnet(userId: string, ipAddress: string): Promise<Expose<ApprovedSubnet>> {
    const subnet = anonymize(ipAddress);
    const previousSubnets = await this.prisma.approvedSubnet.findMany({
      where: {user: {id: userId}},
    });
    for await (const item of previousSubnets) {
      if (await compareHash(subnet, item.subnet)) return expose<ApprovedSubnet>(item);
    }
    return await this.approveNewSubnet(userId, ipAddress);
  }
}
