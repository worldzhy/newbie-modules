import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { MfaMethod } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { TokenService } from "../../security/token/token.service";
import { TokenSubject } from "../../security/token/token.constants";
import { MfaTokenPayload } from "../../account.interface";

const MULTI_FACTOR_TOKEN_TTL_SECONDS = 5 * 60;
// Accept one adjacent 30-second step so minor clock skew never locks users out.
const TOTP_VERIFICATION_WINDOW = 1;
const TOTP_LOGIN_MAX_ATTEMPTS = 5;
const TOTP_LOGIN_ATTEMPT_WINDOW_SECONDS = 300;

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
  ) {
    authenticator.options = { window: TOTP_VERIFICATION_WINDOW };
  }

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

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, "NightWatch", secret);
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
    if (!authenticator.check(code, user.twoFactorSecret)) {
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
      params.code && user.twoFactorSecret ? authenticator.check(params.code, user.twoFactorSecret) : false;
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
   */
  async consumeMfaChallenge(params: { token: string; code: string }): Promise<string> {
    const payload = this.tokenService.verify<MfaTokenPayload>({
      token: params.token,
      options: { subject: TokenSubject.MULTI_FACTOR_TOKEN },
    });

    const attemptKey = payload.userId;
    const attempts = await this.totpAttemptLimiter.get(attemptKey);
    if (attempts !== null && attempts.remainingPoints <= 0) {
      throw new ForbiddenException("Too many incorrect authenticator codes. Please log in again.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, status: true, twoFactorSecret: true },
    });
    if (!user) {
      throw new BadRequestException("The account no longer exists.");
    }
    if (!user.twoFactorSecret) {
      throw new BadRequestException("Two-factor authentication is not enabled.");
    }

    if (!authenticator.check(params.code, user.twoFactorSecret)) {
      await this.totpAttemptLimiter.penalty(attemptKey);
      throw new BadRequestException("The authenticator code is invalid.");
    }

    await this.totpAttemptLimiter.delete(attemptKey);
    return user.id;
  }
}
