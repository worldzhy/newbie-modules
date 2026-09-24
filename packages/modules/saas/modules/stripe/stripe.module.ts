import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import {RawBodyMiddleware} from '@devbie/newbie/middlewares/raw-body.middleware';

import {StripeBillingController} from './stripe-billing.controller';
import {StripeWebhookController} from './stripe-webhook.controller';
import {StripeSubscriptionController} from './stripe-subscription.controller';
import {StripeSourcesController} from './stripe-sources.controller';
import {StripeInvoicesController} from './stripe-invoices.controller';
import {StripeService} from './stripe.service';

@Module({
  controllers: [
    StripeBillingController,
    StripeInvoicesController,
    StripeSourcesController,
    StripeSubscriptionController,
    StripeWebhookController,
  ],
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RawBodyMiddleware).forRoutes({
      path: '/webhooks/stripe',
      method: RequestMethod.POST,
    });
  }
}
