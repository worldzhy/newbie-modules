import { Injectable } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { TokenService } from "@modules/security/token/token.service";
import { TwoFactorService } from "@modules/account/modules/two-factor/two-factor.service";
import { expose } from "@modules/account/helpers/expose";
import { AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";

@Injectable()
export class WechatAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  async login(params: { ipAddress: string; userAgent: string; phone: string; openId: string }) {
    const { ipAddress, userAgent, phone, openId } = params;

    // [step 1] Get user — phone is the identity anchor for WeChat login.
    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (user) {
      // The matched row is authoritative; refresh lastLoginAt (and wechatOpenId
      // if it changed) on that exact row, never on an unrelated row found by
      // wechatOpenId.
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          wechatOpenId: openId,
        },
      });
    } else {
      // Create new user if not exists
      user = await this.prisma.user.create({
        data: { phone, wechatOpenId: openId, lastLoginAt: new Date() },
      });
    }

    // [step 1.5] Account-level TOTP gate — placed before any session teardown
    // so an unfinished login leaves existing sessions intact.
    const mfaChallenge = await this.twoFactorService.evaluateLoginMfaGate(user.id);
    if (mfaChallenge) return mfaChallenge;

    // [step 2] Disable active session if existed.
    await this.prisma.session.deleteMany({ where: { userId: user.id } });

    // [step 3] Generate new tokens.
    const session = await this.sessionService.generate({
      ipAddress,
      userAgent,
      userId: user.id,
    });

    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);

    await this.auditLogService.record(AuditEvent.LOGIN, { actorId: user.id, ipAddress, userAgent });

    // [step 4] Return tokens.
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
      refreshToken: session.refreshToken,
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
