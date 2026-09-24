import {Module} from '@nestjs/common';

import {WebhookController} from './webhooks.controller';
import {WebhooksService} from './webhooks.service';

@Module({
  controllers: [WebhookController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
