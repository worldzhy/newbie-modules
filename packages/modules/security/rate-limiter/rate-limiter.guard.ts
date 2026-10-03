import { Inject, Injectable, ExecutionContext } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { LimitAccessByIpService, LimitLoginByIpService, LimitLoginByUserService } from "./rate-limiter.service";
import { LIMIT_ACCESS_BY_IP, LIMIT_LOGIN_BY_IP, LIMIT_LOGIN_BY_USER } from "./rate-limiter.decorator";
import { LOGIN_ACCOUNT_RESOLVER, LoginAccountResolver } from "../ports/login-account.resolver";

@Injectable()
export class RateLimiterGuard {
  constructor(
    private readonly limitAccessByIpService: LimitAccessByIpService,
    private readonly limitLoginByIpService: LimitLoginByIpService,
    private readonly limitLoginByUserService: LimitLoginByUserService,
    @Optional()
    @Inject(LOGIN_ACCOUNT_RESOLVER)
    private readonly loginAccountResolver: LoginAccountResolver | undefined,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Rate limiter for accessing by counting ip visits.
    const limitAccessByIp = this.reflector.getAllAndOverride<boolean>(LIMIT_ACCESS_BY_IP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (limitAccessByIp) {
      const ipAddress = context.switchToHttp().getRequest().socket.remoteAddress;
      const isAllowed = await this.limitAccessByIpService.isAllowed(ipAddress);

      if (isAllowed) {
        await this.limitAccessByIpService.increment(ipAddress);
      } else {
        throw new NewbieException(NewbieExceptionType.Access_HighFrequency);
      }
    }

    // Rate limiter for logging in by counting ip visits.
    const limitLoginByIp = this.reflector.getAllAndOverride<boolean>(LIMIT_LOGIN_BY_IP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (limitLoginByIp) {
      const ipAddress = context.switchToHttp().getRequest().socket.remoteAddress;
      const isAllowed = await this.limitLoginByIpService.isAllowed(ipAddress);

      if (isAllowed) {
        await this.limitLoginByIpService.increment(ipAddress);
      } else {
        throw new NewbieException(NewbieExceptionType.Login_HighFrequency);
      }
    }

    // Rate limiter for logging in by counting user visits.
    // The account -> userId translation comes from the identity provider via
    // the LoginAccountResolver port; without a resolver this limiter is a
    // graceful no-op (IP limiting above still applies).
    const limitLoginByUser = this.reflector.getAllAndOverride<boolean>(LIMIT_LOGIN_BY_USER, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (limitLoginByUser && this.loginAccountResolver) {
      const { account } = context.switchToHttp().getRequest().body;
      // Skip the per-user limiter when the body carries no account identifier;
      // newer validator versions throw on non-string input instead of returning false.
      const userId = typeof account === "string" ? await this.loginAccountResolver.findAccountId(account) : null;

      if (userId) {
        const isAllowed = await this.limitLoginByUserService.isAllowed(userId);

        if (isAllowed) {
          await this.limitLoginByUserService.increment(userId);
        } else {
          throw new NewbieException(NewbieExceptionType.Login_ExceededAttempts);
        }
      }
    }

    return true;
  }
}
