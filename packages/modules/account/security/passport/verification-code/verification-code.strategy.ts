import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {Strategy} from 'passport-local';
import {VerificationCodeUse} from '@generated/prisma/client';
import {VerificationCodeService} from '@microservices/account/modules/verification-code/verification-code.service';
import {UserService} from '@microservices/account/modules/user/user.service';
import {verifyEmail, verifyPhone} from '@microservices/account/helpers/validator';

@Injectable()
export class VerificationCodeStrategy extends PassportStrategy(Strategy, 'local.verification-code') {
  constructor(
    private readonly verificationCodeService: VerificationCodeService,
    private readonly userService: UserService
  ) {
    super({usernameField: 'account', passwordField: 'verificationCode'});
  }

  /**
   * 'vaidate' function must be implemented.
   *
   * The 'account' parameter accepts:
   * [1] email
   * [2] phone
   *
   */
  async validate(account: string, verificationCode: string): Promise<{userId: string}> {
    // [step 1] Get the user.
    const user = await this.userService.findByAccount(account);
    if (!user) {
      throw new UnauthorizedException('The user does not exist.');
    }

    // [step 2] Handle invalid account situation.
    if (!verifyEmail(account) && !verifyPhone(account)) {
      throw new UnauthorizedException('Invalid account.');
    }

    // [step 3] Validate verification code.
    // Only a code issued for the login purpose can complete the login.
    const isCodeValid = verifyEmail(account)
      ? await this.verificationCodeService.validateForEmail(
          verificationCode,
          account,
          VerificationCodeUse.LOGIN_BY_EMAIL
        )
      : await this.verificationCodeService.validateForPhone(
          verificationCode,
          account,
          VerificationCodeUse.LOGIN_BY_PHONE
        );
    if (!isCodeValid) {
      throw new UnauthorizedException('Invalid code.');
    }

    // [Step 4] OK.
    return {userId: user.id};
  }
}
