import { Global, Module } from "@nestjs/common";

import { WebhookController } from "./webhook.controller";
import { WebhookService } from "./webhook.service";

@Global()
@Module({
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
