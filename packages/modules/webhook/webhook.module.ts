import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
