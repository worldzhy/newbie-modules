import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@generated/prisma/client";
import { ApprovedSubnet } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import anonymize from "ip-anonymize";
import { APPROVED_SUBNET_NOT_FOUND, UNAUTHORIZED_RESOURCE } from "@devbie/newbie/exceptions/errors.constants";
import { Expose, expose } from "../../helpers/expose";
import { GeolocationService } from "../../helpers/geolocation.service";
import { computeSubnetHmac } from "../../helpers/subnet-hmac";
import { compareHash, generateHash } from "@devbie/newbie/utilities/common.util";

@Injectable()
export class ApprovedSubnetService {
  private readonly hmacSecret: string;

  constructor(
    private prisma: PrismaService,
    private geolocationService: GeolocationService,
    config: ConfigService,
  ) {
    // Fall back to the framework token secret so the feature works with no
    // extra configuration in development.
    this.hmacSecret =
      config.get<string>("modules.account.approvedSubnet.hmacSecret") ||
      config.getOrThrow<string>("modules.security.token.defaultSecret");
  }

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

  /**
   * Approve the subnet behind an IP address. The deterministic HMAC makes
   * repeated approvals idempotent — an already-approved subnet resolves to
   * its existing row instead of creating duplicates.
   */
  async approveNewSubnet(userId: string, ipAddress: string) {
    const anonymizedSubnet = anonymize(ipAddress);
    if (!anonymizedSubnet) throw new BadRequestException("The IP address cannot be anonymized.");
    const subnetHmac = computeSubnetHmac({ subnet: anonymizedSubnet, secret: this.hmacSecret });

    const existingSubnet = await this.prisma.approvedSubnet.findUnique({
      where: { userId_subnetHmac: { userId, subnetHmac } },
    });
    if (existingSubnet) {
      return expose<ApprovedSubnet>(existingSubnet);
    }

    // Keep writing the bcrypt value as well: rows are still matched through
    // the legacy scan when the HMAC index cannot be used.
    const subnet = await generateHash(anonymizedSubnet);
    const location = await this.geolocationService.getLocation(ipAddress);
    const approvedSubnet = await this.prisma.approvedSubnet.create({
      data: {
        user: { connect: { id: userId } },
        subnet,
        subnetHmac,
        city: location?.city?.names?.en,
        region: location?.subdivisions?.pop()?.names?.en,
        timezone: location?.location?.time_zone,
        countryCode: location?.country?.iso_code,
      },
    });
    return expose<ApprovedSubnet>(approvedSubnet);
  }

  /** Constant-time lookup of a user's approved subnet by HMAC. */
  async findByHmac(userId: string, subnetHmac: string): Promise<ApprovedSubnet | null> {
    return await this.prisma.approvedSubnet.findUnique({
      where: { userId_subnetHmac: { userId, subnetHmac } },
    });
  }

  /**
   * Check whether the subnet behind an IP is approved.
   *
   * The indexed HMAC lookup runs first and resolves in O(1). Rows written
   * before HMAC support carry a null HMAC, so they are matched through the
   * legacy bcrypt scan — existing data never needs to be migrated.
   */
  async isSubnetApproved(userId: string, ipAddress: string): Promise<boolean> {
    const anonymizedSubnet = anonymize(ipAddress);
    if (!anonymizedSubnet) return false;
    const subnetHmac = computeSubnetHmac({ subnet: anonymizedSubnet, secret: this.hmacSecret });

    const hmacRow = await this.findByHmac(userId, subnetHmac);
    if (hmacRow) return true;

    const previousSubnets = await this.prisma.approvedSubnet.findMany({ where: { userId } });
    const subnetMatches = await Promise.all(previousSubnets.map((item) => compareHash(anonymizedSubnet, item.subnet)));
    return subnetMatches.some(Boolean);
  }
}
