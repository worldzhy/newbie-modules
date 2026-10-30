import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Single shared ioredis connection for the whole application.
 *
 * Redis is an optional foundation dependency: when REDIS_HOST is not
 * configured, no connection is created and isConfigured() returns false so
 * that consumers can fall back to in-memory implementations.
 *
 * The client is created in the constructor (not onModuleInit) because some
 * consumers (e.g. rate limiters) choose their backend in their own
 * constructor: Nest builds every provider before running any onModuleInit
 * hook, so lazy initialization would wrongly force the memory fallback.
 * ioredis itself opens the socket asynchronously regardless.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private client?: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>("modules.redis.host");
    if (!host) return;
    this.client = new Redis({
      host,
      port: this.configService.get<number>("modules.redis.port"),
      password: this.configService.get<string>("modules.redis.password") || undefined,
      db: this.configService.get<number>("modules.redis.db"),
    });
    this.client.on("error", (err: Error) => {
      this.logger.error("Redis error:", err.message);
    });
  }

  /**
   * Close the shared connection on shutdown. ioredis keeps the socket (and the
   * process's event loop) alive otherwise, so a forgotten client turns into a
   * leaked connection per restart and blocks graceful termination.
   */
  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch (error) {
      this.logger.warn(`Redis quit failed, forcing disconnect: ${(error as Error).message}`);
      this.client.disconnect();
    }
  }

  isConfigured(): boolean {
    return this.client !== undefined;
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error("Redis is not configured. Set REDIS_HOST to enable the shared Redis connection.");
    }
    return this.client;
  }
}
