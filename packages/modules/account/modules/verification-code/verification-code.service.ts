import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {VerificationCode, VerificationCodeStatus, VerificationCodeUse} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {currentPlusMinutes} from '@devbie/newbie/utilities/datetime.util';
import {generateRandomNumbers} from '@devbie/newbie/utilities/common.util';

// Todo: We do not support inactivate verification code automatically now.

@Injectable()
export class VerificationCodeService {
  public timeoutMinutes: number; // The verification code will be invalid after x minutes.
  public resendMinutes: number; // The verification code can be resend after y minute.

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {
    this.timeoutMinutes = this.config.getOrThrow<number>('microservices.account.verificationCode.timeoutMinutes');
    this.resendMinutes = this.config.getOrThrow<number>('microservices.account.verificationCode.resendMinutes');
  }

  async generateForEmail(email: string, use: VerificationCodeUse): Promise<VerificationCode> {
    // [step 1] Return the verification code of the same purpose generated within the resend window.
    // Codes are scoped by 'use', so a login code and a reset-password code never collide.
    const validCode = await this.prisma.verificationCode.findFirst({
      where: {
        email: {equals: email, mode: 'insensitive'},
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

    // [step 2] Inactive current valid verification codes of the same purpose.
    await this.prisma.verificationCode.updateMany({
      where: {
        AND: {
          email: {equals: email, mode: 'insensitive'},
          use: use,
          status: VerificationCodeStatus.ACTIVE,
        },
      },
      data: {status: VerificationCodeStatus.INACTIVE},
    });

    // [step 3] Generate and send verification code.
    const newCode = generateRandomNumbers(6);
    return await this.prisma.verificationCode.create({
      data: {
        email: email,
        code: newCode,
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: currentPlusMinutes(this.timeoutMinutes),
      },
    });
  }

  async generateForPhone(phone: string, use: VerificationCodeUse): Promise<VerificationCode> {
    // [step 1] Return the verification code of the same purpose generated within the resend window.
    // Codes are scoped by 'use', so a login code and a reset-password code never collide.
    const validCode = await this.prisma.verificationCode.findFirst({
      where: {
        phone: phone,
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

    // [step 2] Inactive current valid verification codes of the same purpose.
    await this.prisma.verificationCode.updateMany({
      where: {AND: {phone: phone, use: use, status: VerificationCodeStatus.ACTIVE}},
      data: {status: VerificationCodeStatus.INACTIVE},
    });

    // [step 3] Generate and send verification code.
    const newCode = generateRandomNumbers(6);

    // [step 4] Save the code in database.
    return await this.prisma.verificationCode.create({
      data: {
        phone: phone,
        code: newCode,
        use: use,
        status: VerificationCodeStatus.ACTIVE,
        expiredAt: currentPlusMinutes(this.timeoutMinutes),
      },
    });
  }

  async validateForEmail(code: string, email: string, use: VerificationCodeUse): Promise<boolean> {
    const existedCode = await this.prisma.verificationCode.findFirst({
      where: {
        email: {equals: email, mode: 'insensitive'},
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

  async validateForPhone(code: string, phone: string, use: VerificationCodeUse): Promise<boolean> {
    const existedCode = await this.prisma.verificationCode.findFirst({
      where: {
        phone: phone,
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
}
