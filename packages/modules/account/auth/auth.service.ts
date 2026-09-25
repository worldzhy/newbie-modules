import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {User, UserGender} from '@generated/prisma/client';
import axios from 'axios';
import {Response} from 'express';
import {
  EMAIL_USER_CONFLICT,
  INVALID_EMAIL,
  UNVERIFIED_EMAIL,
  UNVERIFIED_LOCATION,
  USER_NOT_FOUND,
} from '@devbie/newbie/exceptions/errors.constants';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {compareHash} from '@devbie/newbie/utilities/common.util';
import {SignUpDto} from '@modules/account/auth/auth.dto';
import {Expose, expose} from '@modules/account/helpers/expose';
import {verifyEmail} from '@modules/account/helpers/validator';
import {GeolocationService} from '@modules/account/helpers/geolocation.service';
import {ApprovedSubnetService} from '@modules/account/modules/approved-subnet/approved-subnet.service';
import {SessionService} from '@modules/account/modules/session/session.service';
import {CookieService} from '@modules/account/security/cookie/cookie.service';
import {TokenService} from '@modules/account/security/token/token.service';
import {TokenSubject} from '@modules/account/security/token/token.constants';
import {AwsSesService} from '@modules/aws-ses/aws-ses.service';
import anonymize from 'ip-anonymize';
import randomColor from 'randomcolor';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private appFrontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly cookieService: CookieService,
    private readonly approvedSubnetService: ApprovedSubnetService,
    private readonly geolocationService: GeolocationService,
    private readonly ses: AwsSesService
  ) {
    this.appFrontendUrl = this.config.getOrThrow('framework.app.frontendUrl');
  }

  async login(params: {
    ipAddress: string;
    userAgent: string;
    userId: string;
    skipEmailCheck?: boolean;
    skipLocationCheck?: boolean;
    response: Response;
  }) {
    // [step 0] Check email and location.
    if (!params.skipEmailCheck) {
      await this.checkEmailOnLogin({userId: params.userId});
    }
    if (!params.skipLocationCheck) {
      await this.checkLocationOnLogin({
        userId: params.userId,
        ipAddress: params.ipAddress,
      });
    }

    // [step 1] Disable active session if existed.
    await this.prisma.session.deleteMany({where: {userId: params.userId}});

    // [step 2] Update last login time.
    await this.prisma.user.update({
      where: {id: params.userId},
      data: {lastLoginAt: new Date()},
    });

    // [step 3] Generate new tokens.
    const session = await this.sessionService.generate({
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      userId: params.userId,
    });

    // [step 4] Set refresh token in cookie.
    this.cookieService.set(params.response, this.cookieService.generateForRefreshToken(session.refreshToken));

    // [step 5] Return access token.
    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
    };
  }

  async signup(params: {ipAddress: string; userData: SignUpDto}): Promise<Expose<User>> {
    const {email, ...data} = params.userData;

    if (!verifyEmail(email)) {
      throw new BadRequestException(INVALID_EMAIL);
    }

    if ((await this.prisma.user.count({where: {email}})) > 0) {
      throw new ConflictException(EMAIL_USER_CONFLICT);
    }

    // Generate profile picture
    let uiAvatarsName: string | undefined = undefined;
    if (data.name) {
      uiAvatarsName = data.name;
    } else if (data.firstName && data.lastName) {
      uiAvatarsName = `${data.firstName} ${data.lastName}`;
    } else if (data.firstName) {
      uiAvatarsName = data.firstName;
    } else if (data.lastName) {
      uiAvatarsName = data.lastName;
    } else if (data.username) {
      uiAvatarsName = data.username;
    } else {
      uiAvatarsName = email.split('@')[0];
    }
    const uiAvatarsUrl = `https://ui-avatars.com/api/?name=${uiAvatarsName}&background=${randomColor({
      luminosity: 'light',
    }).replace('#', '')}&color=000000`;

    // Generate user gender
    if (!data.gender) {
      if (data.name) {
        try {
          const prediction = await axios.get<{
            name: string;
            gender: 'male' | 'female';
            probability: number;
            count: number;
          }>(`https://api.genderize.io/?name=${data.name.split(' ')[0]}`);
          if (prediction.data.probability > 0.5 && prediction.data.gender === 'male') data.gender = UserGender.MALE;
          if (prediction.data.probability > 0.5 && prediction.data.gender === 'female') data.gender = UserGender.FEMALE;
        } catch (error) {
          // Best-effort enrichment: gender prediction is optional and must not block sign-up.
          this.logger.debug(`Gender prediction failed for name "${data.name}": ${error}`);
        }
      }
    }

    // Create user
    const user = await this.prisma.user.create({
      data: {...data, email, emails: {create: {email}}, uiAvatarsUrl},
      include: {emails: {select: {id: true}}},
    });

    // In testing, we auto-approve the email
    if (process.env.ENVIRONMENT !== 'production') {
      const emailId = user.emails[0]?.id;
      if (emailId)
        await this.prisma.email.update({
          where: {id: emailId},
          data: {isVerified: true},
        });
    } else {
      await this.ses.sendEmailWithTemplate({
        toAddress: `"${user.name}" <${email}>`,
        template: {
          'auth/verify-email': {
            userName: user.name || 'Dear',
            link: `${this.config.get<string>(
              'framework.app.frontendUrl'
            )}/auth/link/verify-email?token=${this.tokenService.sign({
              payload: {id: user.emails[0].id},
              options: {
                subject: TokenSubject.APPROVE_EMAIL_TOKEN,
                expiresIn: '7d',
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

  async refreshAccessToken(params: {refreshToken: string; response: Response}) {
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

  private async checkEmailOnLogin(params: {userId: string}) {
    const user = await this.prisma.user.findUnique({
      where: {id: params.userId},
      select: {email: true, name: true, emails: true},
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);

    if (!user.emails.find(i => i.email === user.email)?.isVerified) throw new UnauthorizedException(UNVERIFIED_EMAIL);
  }

  private async checkLocationOnLogin(params: {userId: string; ipAddress: string}): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {id: params.userId},
      select: {email: true, name: true, checkLocationOnLogin: true},
    });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    if (!user.checkLocationOnLogin) return;

    const subnet = anonymize(params.ipAddress);
    const previousSubnets = await this.prisma.approvedSubnet.findMany({
      where: {user: {id: params.userId}},
    });
    let isApproved = false;
    for await (const item of previousSubnets) {
      if (!isApproved) if (await compareHash(subnet, item.subnet)) isApproved = true;
    }

    if (!isApproved) {
      const location = await this.geolocationService.getLocation(params.ipAddress);
      const locationName =
        [location?.city?.names?.en, (location?.subdivisions ?? [])[0]?.names?.en, location?.country?.names?.en]
          .filter(i => i)
          .join(', ') || 'Unknown location';
      if (user.email) {
        this.ses.sendEmailWithTemplate({
          toAddress: user.email,
          template: {
            'auth/verify-subnet': {
              userName: user.name ?? 'friend',
              locationName,
              link: `${this.appFrontendUrl}/auth/link/approve-subnet?token=${this.tokenService.sign({
                payload: {userId: params.userId},
                options: {
                  subject: TokenSubject.APPROVE_SUBNET_TOKEN,
                  expiresIn: '30m',
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

  /* End */
}
