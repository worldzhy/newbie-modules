import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { RedisService } from "@modules/redis/redis.service";

enum LimiterType {
  IP_ACCESS = "ip-access",
  IP_LOGIN = "ip-login",
  USER_LOGIN = "user-login",
  INSTALLATION = "installation",
  TOTP_LOGIN = "totp-login",
}

abstract class RateLimiterService {
  private limiter: RateLimiterMemory | RateLimiterRedis;
  private points: number;
  private duration: number;

  constructor(
    private readonly config: ConfigService,
    redis: RedisService,
    limiterType: LimiterType,
  ) {
    switch (limiterType) {
      case LimiterType.IP_ACCESS:
        this.points = this.config.getOrThrow<number>("modules.security.ratelimiter.ipAccessLimiter.points");
        this.duration = this.config.getOrThrow<number>("modules.security.ratelimiter.ipAccessLimiter.durationSeconds");
        break;
      case LimiterType.IP_LOGIN:
        this.points = this.config.getOrThrow<number>("modules.security.ratelimiter.ipLoginLimiter.points");
        this.duration = this.config.getOrThrow<number>("modules.security.ratelimiter.ipLoginLimiter.durationSeconds");
        break;
      case LimiterType.USER_LOGIN:
        this.points = this.config.getOrThrow<number>("modules.security.ratelimiter.userLoginLimiter.points");
        this.duration = this.config.getOrThrow<number>("modules.security.ratelimiter.userLoginLimiter.durationSeconds");
        break;
      case LimiterType.INSTALLATION:
        this.points = this.config.getOrThrow<number>("modules.security.ratelimiter.installationLimiter.points");
        this.duration = this.config.getOrThrow<number>(
          "modules.security.ratelimiter.installationLimiter.durationSeconds",
        );
        break;
      case LimiterType.TOTP_LOGIN:
        this.points = this.config.getOrThrow<number>("modules.security.ratelimiter.totpLoginLimiter.points");
        this.duration = this.config.getOrThrow<number>("modules.security.ratelimiter.totpLoginLimiter.durationSeconds");
        break;
    }

    const options = {
      keyPrefix: limiterType + "-",
      points: this.points,
      duration: this.duration,
    };
    // All limiters share the single connection owned by the redis foundation
    // module; rate-limiter-flexible isolates them via keyPrefix.
    this.limiter = redis.isConfigured()
      ? new RateLimiterRedis({ storeClient: redis.getClient(), ...options })
      : new RateLimiterMemory(options);
  }

  async isAllowed(key: string): Promise<boolean> {
    const res = await this.limiter.get(key);
    // If there are no previous attempts, allow. Otherwise, check if there are remaining points.
    return !res ? true : res.remainingPoints > 0;
  }

  async increment(key: string): Promise<void> {
    await this.limiter.consume(key);
  }

  async delete(key: string): Promise<void> {
    await this.limiter.delete(key);
  }
}

@Injectable()
export class LimitAccessByIpService extends RateLimiterService {
  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, LimiterType.IP_ACCESS);
  }
}

@Injectable()
export class LimitLoginByIpService extends RateLimiterService {
  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, LimiterType.IP_LOGIN);
  }
}

@Injectable()
export class LimitLoginByUserService extends RateLimiterService {
  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, LimiterType.USER_LOGIN);
  }
}

/**
 * Per-installation quota for machine-to-machine report endpoints (ADR-011).
 * The bucket key is the SHA-256 of the presented installation token, which is
 * equivalent to keying by installation (one token per installation) without
 * storing usable credentials in the limiter backend. Enforced inside the
 * InstallationAuthGuard, not by decorator.
 */
@Injectable()
export class LimitInstallationByTokenService extends RateLimiterService {
  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, LimiterType.INSTALLATION);
  }
}

/**
 * Bounds online guessing of TOTP codes during the login MFA challenge, keyed
 * by user id. Shares the Redis-backed base with the other login limiters so
 * the cap holds across multiple instances (previously a per-process
 * RateLimiterMemory inside TwoFactorService).
 */
@Injectable()
export class LimitTotpLoginByUserService extends RateLimiterService {
  constructor(configService: ConfigService, redisService: RedisService) {
    super(configService, redisService, LimiterType.TOTP_LOGIN);
  }
}
