import { Injectable } from "@nestjs/common";
import { UserService } from "@modules/account/modules/user/user.service";
import { LoginAccountResolver } from "@modules/security/ports/login-account.resolver";

/**
 * Account-side binding of security's LoginAccountResolver port. Translates a
 * login identifier (email or phone) to the user id, so the per-user login
 * rate limiter shares one bucket across a user's aliases.
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- bound via the LOGIN_ACCOUNT_RESOLVER useClass provider
export class AccountLoginAccountResolver implements LoginAccountResolver {
  constructor(private readonly userService: UserService) {}

  async findAccountId(account: string): Promise<string | null> {
    const user = await this.userService.findByAccount(account);
    return user?.id ?? null;
  }
}
