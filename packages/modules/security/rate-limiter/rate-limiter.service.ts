import { Injectable, Logger } from "@nestjs/common";
import { RateLimiterMemory, RateLimiterRedis } from "rate-limiter-flexible";
import { getErrorMessage } from "@devbie/newbie/utilities/error-message.util";
import { RedisService } from "@modules/redis/redis.service";
import { SECURITY_RATE_LIMITER } from "../security-config.constants";

export interface RateLimiterOptions {
  keyPrefix: string;
  points: number;
  duration: number;
}

/** The subset of rate-limiter-flexible's API this module depends on. */
export interface RateLimiterStore {
  get(key: string): Promise<{ remainingPoints: number } | null>;
  consume(key: string): Promise<{ remainingPoints: number }>;
  delete(key: string): Promise<unknown>;
}

function createRedisStore(redisService: RedisService, options: RateLimiterOptions): RateLimiterStore | null {
  return redisService.isConfigured()
    ? new RateLimiterRedis({ storeClient: redisService.getClient(), ...options })
    : null;
}

/**
 * Rate limiter shared by the security providers and by feature modules that
 * need their own quota (e.g. verification-code attempts).
 *
 * The Redis connection is created with `enableOfflineQueue: false`, so a blip
 * rejects commands immediately. Rather than letting that rejection reach the
 * global filter as a 500, a failure logs once per instance and the operation
 * fails open.
 */
export class RateLimiter {
  private readonly logger: Logger;
  private readonly primary: RateLimiterStore;
  private degraded = false;

  constructor(options: RateLimiterOptions, primary: RateLimiterStore | null, context = RateLimiter.name) {
    this.logger = new Logger(context);
    this.primary = primary ?? new RateLimiterMemory(options);
  }

  /** Build a limiter backed by the shared Redis connection when configured. */
  static fromRedis(redisService: RedisService, options: RateLimiterOptions, context: string): RateLimiter {
    return new RateLimiter(options, createRedisStore(redisService, options), context);
  }

  async isAllowed(key: string): Promise<boolean> {
    try {
      const res = await this.primary.get(key);
      this.recovered();
      return !res ? true : res.remainingPoints > 0;
    } catch (error) {
      this.degradedTo(error);
      return true;
    }
  }

  /**
   * Spend one point and report the remaining allowance. The verification-code
   * flow uses this instead of a separate limiter instance so both share the
   * same resilience behaviour.
   */
  async spend(key: string): Promise<number> {
    try {
      const res = await this.primary.consume(key);
      this.recovered();
      return res.remainingPoints;
    } catch (error) {
      this.degradedTo(error);
      // The backend cannot be read, so the spent point is unknown; report an
      // unbounded budget rather than inventing a value.
      return Number.POSITIVE_INFINITY;
    }
  }

  async increment(key: string): Promise<void> {
    await this.spend(key);
  }

  async delete(key: string): Promise<void> {
    try {
      await this.primary.delete(key);
      this.recovered();
    } catch (error) {
      this.degradedTo(error);
    }
  }

  private degradedTo(error: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    this.logger.warn(
      `Rate limiter backend unavailable; allowing requests until it recovers: ${getErrorMessage(error)}`,
    );
  }

  private recovered(): void {
    if (!this.degraded) return;
    this.degraded = false;
    this.logger.log("Rate limiter backend recovered; enforcing limits again.");
  }
}

enum LimiterType {
  IP_ACCESS = "ip-access",
  IP_LOGIN = "ip-login",
  USER_LOGIN = "user-login",
  INSTALLATION = "installation",
  TOTP_LOGIN = "totp-login",
}

const LIMITER_LIMITS: Record<LimiterType, { points: number; duration: number }> = {
  [LimiterType.IP_ACCESS]: {
    points: SECURITY_RATE_LIMITER.ipAccessLimiter.points,
    duration: SECURITY_RATE_LIMITER.ipAccessLimiter.durationSeconds,
  },
  [LimiterType.IP_LOGIN]: {
    points: SECURITY_RATE_LIMITER.ipLoginLimiter.points,
    duration: SECURITY_RATE_LIMITER.ipLoginLimiter.durationSeconds,
  },
  [LimiterType.USER_LOGIN]: {
    points: SECURITY_RATE_LIMITER.userLoginLimiter.points,
    duration: SECURITY_RATE_LIMITER.userLoginLimiter.durationSeconds,
  },
  [LimiterType.INSTALLATION]: {
    points: SECURITY_RATE_LIMITER.installationLimiter.points,
    duration: SECURITY_RATE_LIMITER.installationLimiter.durationSeconds,
  },
  [LimiterType.TOTP_LOGIN]: {
    points: SECURITY_RATE_LIMITER.totpLoginLimiter.points,
    duration: SECURITY_RATE_LIMITER.totpLoginLimiter.durationSeconds,
  },
};

/**
 * Security-owned buckets. The window comes from the security config, so these
 * providers stay thin wrappers over the shared limiter.
 */
abstract class RateLimiterService extends RateLimiter {
  constructor(redisService: RedisService, limiterType: LimiterType) {
    const limits = LIMITER_LIMITS[limiterType];
    const options = { keyPrefix: limiterType + "-", points: limits.points, duration: limits.duration };
    super(options, createRedisStore(redisService, options), `RateLimiter(${limiterType})`);
  }
}

@Injectable()
export class LimitAccessByIpService extends RateLimiterService {
  constructor(redisService: RedisService) {
    super(redisService, LimiterType.IP_ACCESS);
  }
}

@Injectable()
export class LimitLoginByIpService extends RateLimiterService {
  constructor(redisService: RedisService) {
    super(redisService, LimiterType.IP_LOGIN);
  }
}

@Injectable()
export class LimitLoginByUserService extends RateLimiterService {
  constructor(redisService: RedisService) {
    super(redisService, LimiterType.USER_LOGIN);
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
  constructor(redisService: RedisService) {
    super(redisService, LimiterType.INSTALLATION);
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
  constructor(redisService: RedisService) {
    super(redisService, LimiterType.TOTP_LOGIN);
  }
}
