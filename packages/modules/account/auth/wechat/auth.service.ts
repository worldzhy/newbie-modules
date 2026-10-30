import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { TokenService } from "@modules/security/token/token.service";
import { AuthService } from "@modules/account/auth/auth.service";
import { expose } from "@modules/account/helpers/expose";

@Injectable()
export class WechatAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
  ) {}

  async login(params: { ipAddress: string; userAgent: string; phone: string; openId: string }) {
    const { ipAddress, userAgent, phone, openId } = params;

    // [step 1] Get user — phone is the identity anchor for WeChat login.
    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (user) {
      // The matched row is authoritative; refresh wechatOpenId (if it changed)
      // on that exact row, never on an unrelated row found by wechatOpenId.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { wechatOpenId: openId },
      });
    } else {
      // Create new user if not exists
      user = await this.prisma.user.create({
        data: {
          phone,
          wechatOpenId: openId,
        },
      });
    }

    // [step 2] Issue the session through the shared exit. WeChat has already
    // proven phone ownership, so the email-verification and location
    // eligibility gates inside AuthService.login() are bypassed by design; the
    // TOTP gate, lastLoginAt update and LOGIN audit stay uniform with every
    // other channel. The mini-program has no cookie jar, so the refresh token
    // travels in the response body instead of a cookie. Existing sessions are
    // left intact — the platform supports concurrent sessions across devices.
    const issued = await this.authService.issueLoginSession({ ipAddress, userAgent, userId: user.id });
    if ("mfaChallenge" in issued) return issued.mfaChallenge;

    // [step 3] Return tokens and the authenticated user.
    return {
      token: issued.token,
      tokenExpiresInSeconds: issued.tokenExpiresInSeconds,
      refreshToken: issued.refreshToken,
      user: expose(user),
    };
  }

  async refreshAccessToken(params: { refreshToken: string }) {
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
