import {Injectable} from '@nestjs/common';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {SessionService} from '@microservices/account/modules/session/session.service';
import {TokenService} from '@microservices/account/security/token/token.service';
import {expose} from '@microservices/account/helpers/expose';

@Injectable()
export class WechatAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService
  ) {}

  async login(params: {ipAddress: string; userAgent: string; phone: string; openId: string}) {
    const {ipAddress, userAgent, phone, openId} = params;

    // [step 1] Get user
    let user = await this.prisma.user.findUnique({where: {phone}});

    if (user) {
      await this.prisma.user.update({
        where: {wechatOpenId: params.openId},
        data: {lastLoginAt: new Date()},
      });
    } else {
      // Create new user if not exists
      user = await this.prisma.user.create({
        data: {phone, wechatOpenId: openId, lastLoginAt: new Date()},
      });
    }

    // [step 2] Disable active session if existed.
    await this.prisma.session.deleteMany({where: {userId: user.id}});

    // [step 3] Generate new tokens.
    const session = await this.sessionService.generate({
      ipAddress,
      userAgent,
      userId: user.id,
    });

    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);

    // [step 4] Return tokens.
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
      refreshToken: session.refreshToken,
      user: expose(user),
    };
  }

  async refreshAccessToken(params: {refreshToken: string}) {
    // [step 1]  Refresh
    const session = await this.sessionService.refresh(params.refreshToken);

    // [step 2] Verify access token
    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);

    // [step 3] Return access token.
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
      refreshToken: session.refreshToken,
    };
  }

  /* End */
}
