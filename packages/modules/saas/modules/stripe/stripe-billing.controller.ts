import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import Stripe from 'stripe';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {
  CreateBillingDto,
  ReplaceBillingDto,
  UpdateBillingDto,
} from './stripe.dto';
import {StripeService} from './stripe.service';

@Controller('teams/:teamId/billing')
export class StripeBillingController {
  constructor(private stripeService: StripeService) {}

  /** Create a billing account for a team */
  @Post()
  @AuditLog('create-billing')
  @Scopes('team-{teamId}:write-billing')
  async createBillingAccount(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: CreateBillingDto
  ): Promise<Stripe.Customer> {
    return this.stripeService.createCustomer(teamId, data);
  }

  /** Read billing for a team */
  @Get()
  @Scopes('team-{teamId}:read-billing')
  async getBillingAccount(
    @Param('teamId', ParseIntPipe) teamId: number
  ): Promise<Stripe.Customer> {
    return this.stripeService.getCustomer(teamId);
  }

  /** Update billing for a team */
  @Patch()
  @AuditLog('update-billing')
  @Scopes('team-{teamId}:write-billing')
  async updateBillingAccount(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: UpdateBillingDto
  ): Promise<Stripe.Customer> {
    return this.stripeService.updateCustomer(teamId, data);
  }

  /** Replace billing for a team */
  @Put()
  @AuditLog('update-billing')
  @Scopes('team-{teamId}:write-billing')
  async replaceBillingAccount(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: ReplaceBillingDto
  ): Promise<Stripe.Customer> {
    return this.stripeService.updateCustomer(teamId, data);
  }

  /** Delete billing for a team */
  @Delete()
  @AuditLog('delete-billing')
  @Scopes('team-{teamId}:delete-billing')
  async deleteBillingAccount(
    @Param('teamId', ParseIntPipe) teamId: number
  ): Promise<Stripe.DeletedCustomer> {
    return this.stripeService.deleteCustomer(teamId);
  }

  /** Get the billing portal link for a team */
  @Get('link')
  @AuditLog('billing-portal')
  @Scopes('team-{teamId}:write-billing')
  async getSession(
    @Param('teamId', ParseIntPipe) teamId: number
  ): Promise<Stripe.Response<Stripe.BillingPortal.Session>> {
    return this.stripeService.getBillingPortalLink(teamId);
  }
}
