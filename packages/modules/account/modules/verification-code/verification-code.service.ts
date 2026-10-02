import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, VerificationCode, VerificationCodeStatus, VerificationCodeUse } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { currentPlusMinutes } from "@devbie/newbie/utilities/datetime.util";
import { generateRandomNumbers } from "@devbie/newbie/utilities/common.util";

// Todo: We do not support inactivate verification code automatically now.

/** A verification code is bound to either an email address or a phone number. */
type VerificationCodeTarget = { email: string } | { phone: string };

@Injectable()
export class VerificationCodeService {
  public timeoutMinutes: number; // The verification code will be invalid after x minutes.
  public resendMinutes: number; // The verification code can be resend after y minute.

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.timeoutMinutes = this.config.getOrThrow<number>("modules.account.verificationCode.timeoutMinutes");
    this.resendMinutes = this.config.getOrThrow<number>("modules.account.verificationCode.resendMinutes");
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
    return await this.prisma.verificationCode.create({
      data: {
        ...target,
        code: newCode,
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: currentPlusMinutes(this.timeoutMinutes),
      },
    });
  }

  private async validate(code: string, target: VerificationCodeTarget, use: VerificationCodeUse): Promise<boolean> {
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
    return existedCode ? true : false;
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

  private targetWhere(target: VerificationCodeTarget): Prisma.VerificationCodeWhereInput {
    // Emails are matched case-insensitively; phone numbers are matched exactly.
    if ("email" in target) {
      return { email: { equals: target.email, mode: "insensitive" } };
    }
    return { phone: target.phone };
  }

  /* End */
}
