import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { MfaMethod } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { INVALID_TOKEN } from "@devbie/newbie/exceptions/errors.constants";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { TokenService } from "@modules/security/token/token.service";
import { TokenSubject } from "@modules/security/token/token.constants";
import { LimitTotpLoginByUserService } from "@modules/security/rate-limiter/rate-limiter.service";
import { MfaTokenPayload, TotpTokenResponse } from "../../account.interface";
import { AuditLogService } from "@modules/audit/audit-log.service";
import { recordLoginFailure } from "../../auth/login-audit";

const MULTI_FACTOR_TOKEN_TTL_SECONDS = 5 * 60;
// Accept one adjacent 30-second step (epochTolerance is in seconds) so minor
// clock skew never locks users out.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
const TOTP_ISSUER = "NightWatch";

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
    // Bounds online guessing of TOTP codes during the login challenge; shares
    // the Redis-backed limiter base with the other login limiters so the cap
    // holds across instances (modules.security.ratelimiter.totpLoginLimiter).
    private readonly limitTotpLoginByUserService: LimitTotpLoginByUserService,
  ) {}

  /**
   * Begin TOTP enrollment. Generates a fresh secret and stores it as pending
   * (twoFactorMethod stays NONE until a code is confirmed through enable()).
   *
   * If TOTP is already enabled, the caller must prove possession of the current
   * credential (password or a valid code) before a new pending secret is
   * issued — this prevents a stolen session from silently rotating the live
   * authenticator (ADR-033).
   */
  async setup(
    userId: string,
    params: { password?: string; code?: string } = {},
  ): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, twoFactorMethod: true, twoFactorSecret: true, password: true },
    });
    if (!user.email) {
      throw new BadRequestException("An email address is required to enroll an authenticator.");
    }

    if (user.twoFactorMethod === MfaMethod.TOTP) {
      const ok = await this.verifyCurrentCredential(user.twoFactorSecret, user.password, params);
      if (!ok) {
        throw new BadRequestException("Provide your current password or a valid authenticator code.");
      }
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: TOTP_ISSUER, label: user.email, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    // The active secret is never overwritten here; enable() promotes the pending
    // value only after a valid code is presented against it.
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingTwoFactorSecret: secret },
    });
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Confirm the pending secret with a code, then atomically promote it to the
   * active secret and switch TOTP on. The active secret is replaced only after
   * the pending code verifies, so a failed enable leaves the live credential
   * intact.
   */
  async enable(userId: string, code: string): Promise<{ twoFactorMethod: MfaMethod }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { twoFactorMethod: true, pendingTwoFactorSecret: true },
    });
    if (!user.pendingTwoFactorSecret) {
      throw new BadRequestException("Start enrollment before confirming a code.");
    }

    const result = await verify({
      token: code,
      secret: user.pendingTwoFactorSecret,
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    if (!result.valid) {
      throw new BadRequestException("The authenticator code is invalid.");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: user.pendingTwoFactorSecret,
        twoFactorMethod: MfaMethod.TOTP,
        pendingTwoFactorSecret: null,
      },
    });
    return { twoFactorMethod: MfaMethod.TOTP };
  }

  /** Turn TOTP off. Requires either the current password or a valid code. */
  async disable(userId: string, params: { password?: string; code?: string }): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, twoFactorSecret: true },
    });

    const ok = await this.verifyCurrentCredential(user.twoFactorSecret, user.password, params);
    if (!ok) {
      throw new BadRequestException("Provide your current password or a valid authenticator code.");
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorMethod: MfaMethod.NONE, twoFactorSecret: null, pendingTwoFactorSecret: null },
    });
  }

  /**
   * Shared credential check for re-bind (setup while enabled) and disable.
   * Accepts the current password or a valid TOTP code against the active
   * secret. Returns false (rather than throwing) so callers can attach the
   * operation-specific error message.
   */
  private async verifyCurrentCredential(
    activeSecret: string | null,
    passwordHash: string | null,
    params: { password?: string; code?: string },
  ): Promise<boolean> {
    const passwordMatches = params.password && passwordHash ? await compareHash(params.password, passwordHash) : false;
    const codeMatches =
      params.code && activeSecret
        ? (
            await verify({
              token: params.code,
              secret: activeSecret,
              epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
            })
          ).valid
        : false;
    return passwordMatches || codeMatches;
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
   * Account-level TOTP gate for login. Returns the MFA challenge payload when
   * the user must complete TOTP before a session is issued, or null when the
   * login may proceed. Every session-minting login path must call this gate
   * exactly once (the shared AuthService.login() calls it internally; Lark and
   * WeChat mint sessions directly and call it before generating the session) —
   * the login-audit-coverage contract test enforces this. The TOTP challenge
   * completion itself passes mfaVerified and skips the gate.
   */
  async evaluateLoginMfaGate(userId: string, mfaVerified = false): Promise<TotpTokenResponse | null> {
    if (mfaVerified) return null;
    if (!(await this.isTotpEnabled(userId))) return null;
    return {
      totpToken: this.issueMfaToken(userId),
      type: MfaMethod.TOTP,
      multiFactorRequired: true,
    };
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
    } catch {
      await recordLoginFailure(this.auditLogService, {
        actorId: null,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "mfa_token_invalid" },
      });
      // The challenge token is a credential submitted with the login-by-totp
      // request: an invalid/expired one is a 400 invalid_grant, not a 401
      // session-authentication failure (newbie ADR-001).
      throw new BadRequestException(INVALID_TOKEN);
    }

    const attemptKey = payload.userId;
    if (!(await this.limitTotpLoginByUserService.isAllowed(attemptKey))) {
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
      await this.limitTotpLoginByUserService.increment(attemptKey);
      await recordLoginFailure(this.auditLogService, {
        actorId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        detail: { reason: "totp_code_invalid" },
      });
      throw new BadRequestException("The authenticator code is invalid.");
    }

    await this.limitTotpLoginByUserService.delete(attemptKey);
    return user.id;
  }
}
