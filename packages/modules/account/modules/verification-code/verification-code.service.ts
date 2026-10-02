import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, VerificationCode, VerificationCodeStatus, VerificationCodeUse } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { currentPlusMinutes } from "@devbie/newbie/utilities/datetime.util";
import { generateRandomNumbers } from "@devbie/newbie/utilities/common.util";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { Redis } from "ioredis";

/** A verification code is bound to either an email address or a phone number. */
type VerificationCodeTarget = { email: string } | { phone: string };

@Injectable()
export class VerificationCodeService {
  public timeoutMinutes: number; // The verification code will be invalid after x minutes.
  public resendMinutes: number; // The verification code can be resend after y minute.
  private attemptLimiter: RateLimiterMemory | RateLimiterRedis;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.timeoutMinutes = this.config.getOrThrow<number>("modules.account.verificationCode.timeoutMinutes");
    this.resendMinutes = this.config.getOrThrow<number>("modules.account.verificationCode.resendMinutes");
    const maxAttempts = this.config.getOrThrow<number>("modules.account.verificationCode.maxAttempts");

    // Bound the number of wrong codes accepted against one target, otherwise
    // the 6-digit code could be brute forced online within its validity window.
    const limiterOptions = {
      keyPrefix: "verification-code-attempt-",
      points: maxAttempts,
      duration: this.timeoutMinutes * 60,
    };
    const redisHost = this.config.get<string>("modules.account.redis.host");
    const redisPort = this.config.get<number>("modules.account.redis.port");
    this.attemptLimiter =
      redisHost && redisPort
        ? new RateLimiterRedis({
            storeClient: new Redis({ host: redisHost, port: redisPort }),
            ...limiterOptions,
          })
        : new RateLimiterMemory(limiterOptions);
  }

  async generateForEmail(email: string, use: VerificationCodeUse): Promise<VerificationCode> {
    return await this.generate({ email }, use);
  }

  async generateForPhone(phone: string, use: VerificationCodeUse): Promise<VerificationCode> {
    return await this.generate({ phone }, use);
  }

  async validateForEmail(code: string, email: string, use: VerificationCodeUse): Promise<boolean> {
    return await this.validate(code, { email }, use);
  }

  async validateForPhone(code: string, phone: string, use: VerificationCodeUse): Promise<boolean> {
    return await this.validate(code, { phone }, use);
  }

  async inactivateForEmail(email: string, use: VerificationCodeUse): Promise<void> {
    await this.inactivate({ email }, use);
  }

  async inactivateForPhone(phone: string, use: VerificationCodeUse): Promise<void> {
    await this.inactivate({ phone }, use);
  }

  private async generate(target: VerificationCodeTarget, use: VerificationCodeUse): Promise<VerificationCode> {
    // [step 1] Return the verification code of the same purpose generated within the resend window.
    // Codes are scoped by 'use', so a login code and a reset-password code never collide.
    const validCode = await this.prisma.verificationCode.findFirst({
      where: {
        ...this.targetWhere(target),
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: {
          gte: currentPlusMinutes(this.timeoutMinutes - this.resendMinutes),
        },
      },
    });
    if (validCode) {
      return validCode;
    }

    // [step 2] Inactivate current valid verification codes of the same purpose.
    await this.inactivate(target, use);

    // [step 3] Generate and save a new verification code.
    const newCode = generateRandomNumbers(6);
    const createdCode = await this.prisma.verificationCode.create({
      data: {
        ...target,
        code: newCode,
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: currentPlusMinutes(this.timeoutMinutes),
      },
    });

    // A fresh code restores the full attempt budget.
    await this.attemptLimiter.delete(this.attemptKey(target, use));
    return createdCode;
  }

  private async validate(code: string, target: VerificationCodeTarget, use: VerificationCodeUse): Promise<boolean> {
    const targetAttemptKey = this.attemptKey(target, use);

    // Once the wrong-attempt budget is spent, fail closed before any lookup.
    const previousAttempts = await this.attemptLimiter.get(targetAttemptKey);
    if (previousAttempts !== null && previousAttempts.remainingPoints <= 0) {
      await this.inactivate(target, use);
      throw this.codeAttemptsExhaustedException();
    }

    const existedCode = await this.prisma.verificationCode.findFirst({
      where: {
        ...this.targetWhere(target),
        code: code,
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: {
          gte: new Date(),
        },
      },
    });

    if (existedCode) {
      await this.attemptLimiter.delete(targetAttemptKey);
      return true;
    }

    // Wrong code: spend one attempt. Consuming the final point invalidates the
    // code so guessing cannot continue against it.
    try {
      await this.attemptLimiter.consume(targetAttemptKey);
    } catch {
      await this.inactivate(target, use);
      throw this.codeAttemptsExhaustedException();
    }
    return false;
  }

  private codeAttemptsExhaustedException(): HttpException {
    // 429 instead of 400: the client must stop guessing and request a new code.
    return new HttpException(
      "Too many incorrect verification attempts. The code has been invalidated; please request a new one.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async inactivate(target: VerificationCodeTarget, use: VerificationCodeUse): Promise<void> {
    await this.prisma.verificationCode.updateMany({
      where: {
        AND: {
          ...this.targetWhere(target),
          use: use,
          status: VerificationCodeStatus.ACTIVE,
        },
      },
      data: { status: VerificationCodeStatus.INACTIVE },
    });
  }

  private attemptKey(target: VerificationCodeTarget, use: VerificationCodeUse): string {
    // Emails are normalized to lower case so the counter cannot be split by case.
    return "email" in target ? `email:${target.email.toLowerCase()}:${use}` : `phone:${target.phone}:${use}`;
  }

  private targetWhere(target: VerificationCodeTarget): Prisma.VerificationCodeWhereInput {
    // Emails are matched case-insensitively; phone numbers are matched exactly.
    if ("email" in target) {
      return { email: { equals: target.email, mode: "insensitive" } };
    }
    return { phone: target.phone };
  }

  /* End */
}
