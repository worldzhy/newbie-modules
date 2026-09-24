import {Injectable} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {Strategy} from 'passport-local';
import {compareHash} from '@devbie/newbie/utilities/common.util';
import {UserService} from '@microservices/account/modules/user/user.service';
import {NewbieException, NewbieExceptionType} from '@devbie/newbie/exceptions/newbie.exception';
import {UserStatus} from '@generated/prisma/client';

@Injectable()
export class PasswordStrategy extends PassportStrategy(Strategy, 'local.password') {
  constructor(private readonly userService: UserService) {
    super({usernameField: 'account', passwordField: 'password'});
  }

  /**
   * 'vaidate' function must be implemented.
   *
   * The 'account' parameter accepts:
   * [1] username
   * [2] email
   * [3] phone
   *
   */
  async validate(account: string, password: string): Promise<{userId: string}> {
    // [step 1] Get the user.
    const user = await this.userService.findByAccount(account);
    if (!user) {
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 2] Check if the account is active.
    if (user.status === UserStatus.INACTIVE) {
      throw new NewbieException(NewbieExceptionType.Login_InactiveUser);
    }

    // [step 3] Handle no password situation.
    if (!user.password) {
      throw new NewbieException(NewbieExceptionType.Login_NoPassword);
    }

    // [step 4] Validate password.
    const match = await compareHash(password, user.password);
    if (match !== true) {
      throw new NewbieException(NewbieExceptionType.Login_WrongInput);
    }

    // [step 5] OK.
    return {userId: user.id};
  }
}
