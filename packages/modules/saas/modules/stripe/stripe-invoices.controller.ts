import {Controller, Get, Param, ParseIntPipe, Query} from '@nestjs/common';
import Stripe from 'stripe';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {Scopes} from '../auth/scope.decorator';
import {StripeService} from './stripe.service';

@Controller('teams/:teamId/invoices')
export class StripeInvoicesController {
  constructor(private stripeService: StripeService) {}

  /** Read invoices for a team */
  @Get()
  @Scopes('team-{teamId}:read-invoice-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: {id: string}
  ): Promise<Stripe.Invoice[]> {
    return this.stripeService.getInvoices(teamId, {take, cursor});
  }

  /** Read an invoice for a team */
  @Get(':id')
  @Scopes('team-{teamId}:read-invoice-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id') id: string
  ): Promise<Stripe.Invoice> {
    return this.stripeService.getInvoice(teamId, id);
  }
}
