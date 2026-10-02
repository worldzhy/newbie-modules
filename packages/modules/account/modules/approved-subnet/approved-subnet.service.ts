import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { Prisma } from "@generated/prisma/client";
import { ApprovedSubnet } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import anonymize from "ip-anonymize";
import { APPROVED_SUBNET_NOT_FOUND, UNAUTHORIZED_RESOURCE } from "@devbie/newbie/exceptions/errors.constants";
import { Expose, expose } from "../../helpers/expose";
import { GeolocationService } from "../../helpers/geolocation.service";
import { generateHash } from "@devbie/newbie/utilities/common.util";

@Injectable()
export class ApprovedSubnetService {
  constructor(
    private prisma: PrismaService,
    private geolocationService: GeolocationService,
  ) {}

  async getApprovedSubnets(
    userId: string,
    params: {
      skip?: number;
      take?: number;
      cursor?: Prisma.ApprovedSubnetWhereUniqueInput;
      where?: Prisma.ApprovedSubnetWhereInput;
      orderBy?: Prisma.ApprovedSubnetOrderByWithAggregationInput;
    },
  ): Promise<Expose<ApprovedSubnet>[]> {
    const { skip, take, cursor, where, orderBy } = params;
    const approvedSubnets = await this.prisma.approvedSubnet.findMany({
      skip,
      take,
      cursor,
      where: { ...where, user: { id: userId } },
      orderBy,
    });
    return approvedSubnets.map((approvedSubnet) => expose<ApprovedSubnet>(approvedSubnet));
  }

  async getApprovedSubnet(userId: string, id: number): Promise<Expose<ApprovedSubnet>> {
    const approvedSubnet = await this.prisma.approvedSubnet.findUnique({
      where: { id },
    });
    if (!approvedSubnet) throw new NotFoundException(APPROVED_SUBNET_NOT_FOUND);
    // Defense in depth: the route guard already performed this same check.
    if (approvedSubnet.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    return expose<ApprovedSubnet>(approvedSubnet);
  }

  async deleteApprovedSubnet(userId: string, id: number): Promise<Expose<ApprovedSubnet>> {
    const approvedSubnet = await this.prisma.approvedSubnet.findUnique({
      where: { id },
    });
    if (!approvedSubnet) throw new NotFoundException(APPROVED_SUBNET_NOT_FOUND);
    if (approvedSubnet.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const deletedSubnet = await this.prisma.approvedSubnet.delete({
      where: { id },
    });
    return expose<ApprovedSubnet>(deletedSubnet);
  }

  async approveNewSubnet(userId: string, ipAddress: string) {
    const subnet = await generateHash(anonymize(ipAddress));
    const location = await this.geolocationService.getLocation(ipAddress);
    const approvedSubnet = await this.prisma.approvedSubnet.create({
      data: {
        user: { connect: { id: userId } },
        subnet,
        city: location?.city?.names?.en,
        region: location?.subdivisions?.pop()?.names?.en,
        timezone: location?.location?.time_zone,
        countryCode: location?.country?.iso_code,
      },
    });
    return expose<ApprovedSubnet>(approvedSubnet);
  }
}
