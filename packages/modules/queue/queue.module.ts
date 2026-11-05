import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bull";

/// Fixed Redis connection port (ADR-033: a tuning knob nobody tuned stays
/// code, not environment surface).
const QUEUE_REDIS_PORT = 6379;

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get("modules.queue.redis.host"),
          port: QUEUE_REDIS_PORT,
          password: configService.get("modules.queue.redis.password"),
        },
      }),
    }),
  ],
})
export class NewbieQueueModule {}
