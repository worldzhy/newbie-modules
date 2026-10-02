import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { User, UserStatus } from "@generated/prisma/client";
import { Response } from "express";
import {
  EMAIL_USER_CONFLICT,
  INVALID_EMAIL,
  UNVERIFIED_EMAIL,
  UNVERIFIED_LOCATION,
  USER_NOT_FOUND,
} from "@devbie/newbie/exceptions/errors.constants";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { SignUpDto } from "@modules/account/auth/auth.dto";
import { Expose, expose } from "@modules/account/helpers/expose";
import { verifyEmail } from "@modules/account/helpers/validator";
import { GeolocationService } from "@modules/account/helpers/geolocation.service";
import { ApprovedSubnetService } from "@modules/account/modules/approved-subnet/approved-subnet.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { CookieService } from "@modules/account/security/cookie/cookie.service";
import { TokenService } from "@modules/account/security/token/token.service";
import { TokenSubject } from "@modules/account/security/token/token.constants";
import { LimitLoginByUserService } from "@modules/account/security/rate-limiter/rate-limiter.service";
import { AwsSesService } from "@modules/aws-ses/aws-ses.service";
import anonymize from "ip-anonymize";
import { buildUiAvatarsUrl } from "@modules/account/helpers/ui-avatar";

@Injectable()
export class AuthService {
  private appFrontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly cookieService: CookieService,
    private readonly approvedSubnetService: ApprovedSubnetService,
    private readonly geolocationService: GeolocationService,
    private readonly ses: AwsSesService,
    private readonly limitLoginByUserService: LimitLoginByUserService,
  ) {
    this.appFrontendUrl = this.config.getOrThrow("framework.app.frontendUrl");
  }

  async login(params: { ipAddress: string; userAgent: string; userId: string; response: Response }) {
    // [step 0] Check email and location.
    await this.checkEmailOnLogin({ userId: params.userId });
    await this.checkLocationOnLogin({
      userId: params.userId,
      ipAddress: params.ipAddress,
    });

    // [step 1] Disable active sessions, update last login time, and generate new tokens atomically.
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: params.userId } });

      await tx.user.update({
        where: { id: params.userId },
        data: { lastLoginAt: new Date() },
      });

      return await this.sessionService.generateWithTransaction(tx, {
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        userId: params.userId,
      });
    });

    // [step 2] Reset the per-user login rate limit so earlier failed attempts
    // do not lock out a user who finally authenticated successfully.
    await this.limitLoginByUserService.delete(params.userId);

    // [step 4] Set refresh token in cookie.
    this.cookieService.set(params.response, this.cookieService.generateForRefreshToken(session.refreshToken));

    // [step 5] Return access token.
    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
    };
  }

  async signup(params: { ipAddress: string; userData: SignUpDto }): Promise<Expose<User>> {
    const { email, ...data } = params.userData;

    if (!verifyEmail(email)) {
      throw new BadRequestException(INVALID_EMAIL);
    }

    if ((await this.prisma.user.count({ where: { email } })) > 0) {
      throw new ConflictException(EMAIL_USER_CONFLICT);
    }

    // Generate profile picture.
    const uiAvatarsUrl = buildUiAvatarsUrl({
      name: data.name,
      firstName: data.firstName,
      lastName: data.lastName,
      fallback: email.split("@")[0],
    });

    // Create user
    const user = await this.prisma.user.create({
      data: { ...data, email, emails: { create: { email } }, uiAvatarsUrl },
      include: { emails: { select: { id: true } } },
    });

    // Auto-approve the email only in explicit non-production environments; an
    // unset or unexpected ENVIRONMENT must fail closed and send the email.
    const environment = process.env.ENVIRONMENT;
    if (environment === "development" || environment === "test") {
      const emailId = user.emails[0]?.id;
      if (emailId)
        await this.prisma.email.update({
          where: { id: emailId },
          data: { isVerified: true },
        });
    } else {
      await this.ses.sendEmailWithTemplate({
        toAddress: `"${user.name}" <${email}>`,
        template: {
          "auth/verify-email": {
            userName: user.name || "Dear",
            link: `${this.config.get<string>(
              "framework.app.frontendUrl",
            )}/auth/link/verify-email?token=${this.tokenService.sign({
              payload: { id: user.emails[0].id },
              options: {
                subject: TokenSubject.APPROVE_EMAIL_TOKEN,
                expiresIn: "7d",
              },
            })}`,
            linkValidDays: 7,
          },
        },
      });
    }

    await this.approvedSubnetService.approveNewSubnet(user.id, params.ipAddress);
    return expose(user);
  }

  async refreshAccessToken(params: { refreshToken: string; response: Response }) {
    // [step 1]  Refresh
    const session = await this.sessionService.refresh(params.refreshToken);

    // [step 2] Set refresh token in cookie.
    this.cookieService.set(params.response, this.cookieService.generateForRefreshToken(session.refreshToken));

    // [step 3] Return access token.
    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
    };
  }

  private async checkEmailOnLogin(params: { userId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, name: true, emails: true },
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    if (!user.emails.find((i) => i.email === user.email)?.isVerified) throw new UnauthorizedException(UNVERIFIED_EMAIL);
  }

  private async checkLocationOnLogin(params: { userId: string; ipAddress: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { email: true, name: true, checkLocationOnLogin: true },
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    if (!user.checkLocationOnLogin) return;

    const subnet = anonymize(params.ipAddress);
    const previousSubnets = await this.prisma.approvedSubnet.findMany({
      where: { user: { id: params.userId } },
    });
    const subnetMatches = await Promise.all(previousSubnets.map((item) => compareHash(subnet, item.subnet)));
    const isApproved = subnetMatches.some((match) => match);

    if (!isApproved) {
      const location = await this.geolocationService.getLocation(params.ipAddress);
      const locationName =
        [location?.city?.names?.en, (location?.subdivisions ?? [])[0]?.names?.en, location?.country?.names?.en]
          .filter((i) => i)
          .join(", ") || "Unknown location";
      if (user.email) {
        this.ses.sendEmailWithTemplate({
          toAddress: user.email,
          template: {
            "auth/verify-subnet": {
              userName: user.name ?? "friend",
              locationName,
              link: `${this.appFrontendUrl}/auth/link/approve-subnet?token=${this.tokenService.sign({
                payload: { userId: params.userId },
                options: {
                  subject: TokenSubject.APPROVE_SUBNET_TOKEN,
                  expiresIn: "30m",
                },
              })}`,
              linkValidMinutes: 30,
            },
          },
        });
      }

      throw new UnauthorizedException(UNVERIFIED_LOCATION);
    }
  }

  /**
   * Complete a Google OAuth login after Passport has verified the Google
   * profile. A first-time Google account is provisioned as a platform user;
   * an existing user goes through the same login flow as every other method.
   */
  async loginByGoogle(params: {
    email: string;
    displayName: string;
    ipAddress: string;
    userAgent: string;
    response: Response;
  }): Promise<{ token: string; tokenExpiresInSeconds: number }> {
    const email = params.email.toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Google has already verified ownership of the email, so the Email
      // record is created pre-verified and no verification email is sent.
      const uiAvatarsUrl = buildUiAvatarsUrl({
        name: params.displayName || undefined,
        fallback: email.split("@")[0],
      });
      user = await this.prisma.user.create({
        data: {
          email,
          name: params.displayName || null,
          uiAvatarsUrl,
          emails: { create: { email, isVerified: true } },
        },
      });
      // Approving the current subnet lets the location check inside login()
      // pass, mirroring the password signup path.
      await this.approvedSubnetService.approveNewSubnet(user.id, params.ipAddress);
    } else {
      if (user.status === UserStatus.INACTIVE) {
        throw new ForbiddenException("The account is not active.");
      }
      // Sync the verification state: Google proved control of the email.
      await this.prisma.email.updateMany({
        where: { email, isVerified: false },
        data: { isVerified: true },
      });
    }

    return await this.login({
      userId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      response: params.response,
    });
  }

  /* End */
}
