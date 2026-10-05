import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { MfaMethod } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { TokenService } from "@modules/security/token/token.service";
import { TokenSubject } from "@modules/security/token/token.constants";
import { MfaTokenPayload } from "../../account.interface";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "../../auth/login-audit";

const MULTI_FACTOR_TOKEN_TTL_SECONDS = 5 * 60;
// Accept one adjacent 30-second step (epochTolerance is in seconds) so minor
// clock skew never locks users out.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
const TOTP_LOGIN_MAX_ATTEMPTS = 5;
const TOTP_LOGIN_ATTEMPT_WINDOW_SECONDS = 300;
const TOTP_ISSUER = "NightWatch";

@Injectable()
export class TwoFactorService {
  // Bound online guessing of TOTP codes during the login challenge.
  private readonly totpAttemptLimiter = new RateLimiterMemory({
    keyPrefix: "totp-login-attempt-",
    points: TOTP_LOGIN_MAX_ATTEMPTS,
    duration: TOTP_LOGIN_ATTEMPT_WINDOW_SECONDS,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Begin TOTP enrollment. Generates a fresh secret and stores it as pending
   * (twoFactorMethod stays NONE until a code is confirmed through enable()).
   */
  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    if (!user.email) {
      throw new BadRequestException("An email address is required to enroll an authenticator.");
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: TOTP_ISSUER, label: user.email, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret },
    });
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /** Confirm the pending secret with a code, then switch TOTP on. */
  async enable(userId: string, code: string): Promise<{ twoFactorMethod: MfaMethod }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorSecret: true },
    });
    if (!user.twoFactorSecret) {
      throw new BadRequestException("Start enrollment before confirming a code.");
    }

    const result = await verify({
      token: code,
      secret: user.twoFactorSecret,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    if (!result.valid) {
      throw new BadRequestException("The authenticator code is invalid.");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: MfaMethod.TOTP },
    });
    return { twoFactorMethod: MfaMethod.TOTP };
  }

  /** Turn TOTP off. Requires either the current password or a valid code. */
  async disable(userId: string, params: { password?: string; code?: string }): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, twoFactorSecret: true },
    });

    const passwordMatches =
      params.password && user.password ? await compareHash(params.password, user.password) : false;
    const codeMatches =
      params.code && user.twoFactorSecret
        ? (
            await verify({
              token: params.code,
              secret: user.twoFactorSecret,
              epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
            })
          ).valid
        : false;
    if (!passwordMatches && !codeMatches) {
      throw new BadRequestException("Provide your current password or a valid authenticator code.");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: MfaMethod.NONE, twoFactorSecret: null },
    });
  }

  /** Whether the user has TOTP enabled. */
  async isTotpEnabled(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorMethod: true },
    });
    return user?.twoFactorMethod === MfaMethod.TOTP;
  }

  /** Sign the short-lived MFA challenge token returned after password verification. */
  issueMfaToken(userId: string): string {
    const payload: MfaTokenPayload = { userId, type: MfaMethod.TOTP };
    return this.tokenService.sign({
      payload,
      options: { subject: TokenSubject.MULTI_FACTOR_TOKEN, expiresIn: MULTI_FACTOR_TOKEN_TTL_SECONDS },
    });
  }

  /**
   * Complete the MFA challenge: verify the challenge token, rate-limit code
   * guesses, validate the TOTP code, and return the authenticated user id.
   * Every rejection is a failed login and is audited with the client context.
   */
  async consumeMfaChallenge(params: {
    token: string;
    code: string;
    ipAddress: string;
    userAgent?: string;
  }): Promise<string> {
    let payload: MfaTokenPayload;
    try {
      payload = this.tokenService.verify<MfaTokenPayload>({
        token: params.token,
        options: { subject: TokenSubject.MULTI_FACTOR_TOKEN },
      });
    } catch (error) {
      await recordLoginFailure(this.auditLogService, {
        actorId: null,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "mfa_token_invalid" },
      });
      throw error;
    }

    const attemptKey = payload.userId;
    const attempts = await this.totpAttemptLimiter.get(attemptKey);
    if (attempts !== null && attempts.remainingPoints <= 0) {
      await recordLoginFailure(this.auditLogService, {
        actorId: payload.userId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "totp_too_many_attempts" },
      });
      throw new ForbiddenException("Too many incorrect authenticator codes. Please log in again.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, twoFactorSecret: true },
    });
    if (!user) {
      await recordLoginFailure(this.auditLogService, {
        actorId: payload.userId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "mfa_user_missing" },
      });
      throw new BadRequestException("The account no longer exists.");
    }
    if (!user.twoFactorSecret) {
      await recordLoginFailure(this.auditLogService, {
        actorId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "totp_not_enabled" },
      });
      throw new BadRequestException("Two-factor authentication is not enabled.");
    }

    const result = await verify({
      token: params.code,
      secret: user.twoFactorSecret,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    if (!result.valid) {
      await this.totpAttemptLimiter.penalty(attemptKey);
      await recordLoginFailure(this.auditLogService, {
        actorId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "totp_code_invalid" },
      });
      throw new BadRequestException("The authenticator code is invalid.");
    }

    await this.totpAttemptLimiter.delete(attemptKey);
    return user.id;
  }
}
