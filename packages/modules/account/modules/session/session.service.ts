import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GeolocationService } from "@modules/account/helpers/geolocation.service";
import { UAParser } from "ua-parser-js";
import { SESSION_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { secondsUntilUnixTimestamp } from "@devbie/newbie/utilities/datetime.util";
import { TokenService } from "../../security/token/token.service";

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
    private readonly tokenService: TokenService,
  ) {}

  async generate(params: { ipAddress: string; userAgent: string; userId: string }) {
    return this.generateWithTransaction(this.prisma, params);
  }

  async generateWithTransaction(
    tx: Prisma.TransactionClient,
    params: { ipAddress: string; userAgent: string; userId: string },
  ) {
    const ua = new UAParser(params.userAgent);
    const location = await this.geolocationService.getLocation(params.ipAddress);
    return await tx.session.create({
      data: {
        accessToken: this.tokenService.signUserAccessToken({
          userId: params.userId,
        }),
        refreshToken: this.tokenService.signUserRefreshToken({
          userId: params.userId,
        }),
        ipAddress: params.ipAddress,
        city: location?.city?.names?.en,
        region: location?.subdivisions?.pop()?.names?.en,
        timezone: location?.location?.time_zone,
        countryCode: location?.country?.iso_code,
        userAgent: params.userAgent,
        browser: `${ua.getBrowser().name ?? ""} ${ua.getBrowser().version ?? ""}`.trim() || undefined,
        operatingSystem:
          `${ua.getOS().name ?? ""} ${ua.getOS().version ?? ""}`.replace("Mac OS", "macOS").trim() || undefined,
        userId: params.userId,
      },
    });
  }

  async refresh(refreshToken: string) {
    // [step 1] Validate refresh token
    const refreshTokenInfo = this.tokenService.verifyUserRefreshToken(refreshToken);

    // [step 2] Rotate tokens. A concurrent or replayed refresh loses the race
    // because the first rotation already replaced the stored refresh token;
    // turn that missing-row error into a 401 instead of a 500.
    try {
      return await this.prisma.session.update({
        where: { refreshToken },
        data: {
          accessToken: this.tokenService.signUserAccessToken({
            userId: refreshTokenInfo.userId,
          }),
          refreshToken: this.tokenService.signUserRefreshToken(
            { userId: refreshTokenInfo.userId },
            { expiresIn: secondsUntilUnixTimestamp(refreshTokenInfo.exp) },
          ),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new UnauthorizedException(SESSION_NOT_FOUND);
      }
      throw error;
    }
  }

  async destroy(token: string) {
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ accessToken: token }, { refreshToken: token }] },
      select: { id: true, user: { select: { id: true } } },
    });
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);

    await this.prisma.session.delete({
      where: { id: session.id },
    });
  }
}
