import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { Response } from "express";
import { UserStatus } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { SessionService } from "@modules/account/modules/session/session.service";
import { TokenService } from "@modules/security/token/token.service";
import { CookieService } from "@modules/security/cookie/cookie.service";
import { ApprovedSubnetService } from "@modules/account/modules/approved-subnet/approved-subnet.service";
import { AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";
import { buildUiAvatarsUrl } from "@modules/account/helpers/ui-avatar";

const FEISHU_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const FEISHU_USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";

interface LarkUserInfo {
  openId: string;
  unionId?: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
}

interface LarkTokenResponse {
  code: number;
  msg: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

interface LarkUserInfoResponse {
  code: number;
  msg: string;
  data: {
    name?: string;
    avatar_url?: string;
    open_id: string;
    union_id?: string;
    email?: string;
    enterprise_email?: string;
  };
}

/**
 * Feishu/Lark OAuth login service.
 *
 * Implements the web authorization-code flow with hand-written HTTP (no
 * Passport). The same LARK_APP_ID/SECRET that the lark foundation module uses
 * is reused so that an app-scoped open_id from a group webhook resolves to the
 * same user account created here.
 *
 * Identity strategy (S1): openId is the primary handle. An existing user with
 * the same openId logs in directly; otherwise an enterprise email (when the
 * app has the email permission) merges into an existing account; otherwise a
 * new account is auto-provisioned from the Lark profile.
 */
@Injectable()
export class LarkAuthService {
  private readonly logger = new Logger(LarkAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly cookieService: CookieService,
    private readonly approvedSubnetService: ApprovedSubnetService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private get appId(): string {
    return this.config.getOrThrow<string>("modules.account.larkAuth.appId");
  }

  private get appSecret(): string {
    return this.config.getOrThrow<string>("modules.account.larkAuth.appSecret");
  }

  private get callbackURL(): string {
    return this.config.getOrThrow<string>("modules.account.larkAuth.callbackURL");
  }

  /**
   * Build the Feishu authorization URL. No user scope is requested: the
   * user_info endpoint returns open_id/union_id/name/avatar by default, and
   * the email field is gated by the tenant-level "获取用户邮箱信息" app
   * permission (enabled in the Feishu console, not user-granted).
   */
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      response_type: "code",
      redirect_uri: this.callbackURL,
      state,
    });
    return `${FEISHU_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for a user_access_token and fetch the
   * user profile. Returns null when the upstream call fails so the controller
   * can surface a clean login error.
   */
  async exchangeCodeForUserInfo(code: string): Promise<LarkUserInfo | null> {
    try {
      const tokenRes = await firstValueFrom(
        this.httpService.post<LarkTokenResponse>(FEISHU_TOKEN_URL, {
          grant_type: "authorization_code",
          client_id: this.appId,
          client_secret: this.appSecret,
          code,
          redirect_uri: this.callbackURL,
        }),
      );

      if (tokenRes.data.code !== 0) {
        this.logger.error(`Lark token exchange failed: ${tokenRes.data.msg}`);
        return null;
      }

      const userAccessToken = tokenRes.data.access_token;

      const userRes = await firstValueFrom(
        this.httpService.get<LarkUserInfoResponse>(FEISHU_USER_INFO_URL, {
          headers: { Authorization: `Bearer ${userAccessToken}` },
        }),
      );

      if (userRes.data.code !== 0) {
        this.logger.error(`Lark user_info failed: ${userRes.data.msg}`);
        return null;
      }

      const data = userRes.data.data;
      return {
        openId: data.open_id,
        unionId: data.union_id,
        name: data.name,
        avatarUrl: data.avatar_url,
        email: data.email || data.enterprise_email,
      };
    } catch (error) {
      this.logger.error(`Lark OAuth exchange failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Resolve or provision a platform user from a Lark identity and issue the
   * platform session. Follows S1: openId lookup -> email merge -> auto
   * provision.
   */
  async loginByLark(params: {
    openId: string;
    unionId?: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    ipAddress: string;
    userAgent: string;
    response: Response;
  }): Promise<{ token: string; tokenExpiresInSeconds: number }> {
    const { openId, unionId, email, displayName, avatarUrl, ipAddress, userAgent, response } = params;

    // [step 1] openId lookup — the primary SSO handle.
    let user = await this.prisma.user.findUnique({ where: { larkOpenId: openId } });

    // [step 2] email merge — when the app has the email permission and an
    // existing account owns that email, attach the Lark identity to it.
    if (!user && email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        user = await this.prisma.user.update({
          where: { id: existing.id },
          data: { larkOpenId: openId, larkUnionId: unionId ?? undefined, lastLoginAt: new Date() },
        });
      }
    }

    // [step 3] auto-provision from the Lark profile.
    if (!user) {
      const uiAvatarsUrl =
        avatarUrl || buildUiAvatarsUrl({ name: displayName || undefined, fallback: openId.slice(-8) });
      user = await this.prisma.user.create({
        data: {
          larkOpenId: openId,
          larkUnionId: unionId,
          name: displayName || null,
          uiAvatarsUrl,
          email: email || undefined,
          emails: email ? { create: { email, isVerified: true } } : undefined,
          lastLoginAt: new Date(),
        },
      });
      // Approve the current subnet so a first-time Lark login is not blocked by
      // the location gate on subsequent password logins.
      await this.approvedSubnetService.approveNewSubnet(user.id, ipAddress);
    } else if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException("The account is not active.");
    } else {
      // Refresh the profile snapshot on returning logins.
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          name: user.name ?? displayName ?? undefined,
          uiAvatarsUrl: user.uiAvatarsUrl ?? avatarUrl ?? undefined,
          larkUnionId: user.larkUnionId ?? unionId ?? undefined,
        },
      });
    }

    // [step 4] Issue the session. Lark OAuth has already proven identity, so
    // the email-verification and location gates are bypassed (same as the
    // WeChat login path). Existing sessions are left intact for multi-device.
    const session = await this.sessionService.generate({ ipAddress, userAgent, userId: user.id });

    this.cookieService.set(response, this.cookieService.generateForRefreshToken(session.refreshToken));

    await this.auditLogService.record(AuditEvent.LOGIN, { actorId: user.id, ipAddress, userAgent });

    const accessTokenInfo = this.tokenService.verifyUserAccessToken(session.accessToken);
    return {
      token: session.accessToken,
      tokenExpiresInSeconds: accessTokenInfo.exp - accessTokenInfo.iat,
    };
  }
}
