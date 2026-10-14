import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Single shared ioredis connection for the whole application.
 *
 * Redis is an optional foundation dependency: when REDIS_HOST is not
 * configured, no connection is created and isConfigured() returns false so
 * that consumers can fall back to in-memory implementations.
 */
@Injectable()
export class RedisService implements OnModuleInit {
  private client?: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
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
