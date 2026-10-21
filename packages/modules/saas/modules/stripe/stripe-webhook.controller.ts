import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { StripeService } from "./stripe.service";

@ApiTags("Stripe Webhooks")
@Controller("webhooks/stripe")
@Public()
export class StripeWebhookController {
  constructor(private stripeService: StripeService) {}

  /** Handle a Stripe webhook */
  @Post()
  @ApiOkResponse()
  async handleWebhook(
    @Headers("stripe-signature") signature: string,
    @Body() raw: Buffer,
  ): Promise<{ received: true }> {
    return this.stripeService.handleWebhook(signature, raw);
  }
}
