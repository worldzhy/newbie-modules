import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/**
 * Shared Redis infrastructure module.
 *
 * Owns the single ioredis connection for the whole application so that any
 * microservice can consume Redis without creating its own connection.
 * Business modules namespace their own keys (e.g. rate-limiter prefixes) and
 * consume the connection through RedisService.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
