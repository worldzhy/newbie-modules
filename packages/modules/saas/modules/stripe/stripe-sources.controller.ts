import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import Stripe from 'stripe';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {StripeService} from './stripe.service';

@Controller('teams/:teamId/sources')
export class StripeSourcesController {
  constructor(private stripeService: StripeService) {}

  /** Create a source for a team */
  @Post()
  @AuditLog('write-source')
  @Scopes('team-{teamId}:write-source-*')
  async create(
    @Param('teamId', ParseIntPipe) teamId: number
  ): Promise<Stripe.Checkout.Session> {
    return this.stripeService.createSession(teamId, 'setup');
  }

  /** Read sources for a team */
  @Get()
  @Scopes('team-{teamId}:read-source-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: {id: string}
  ): Promise<Stripe.CustomerSource[]> {
    return this.stripeService.getSources(teamId, {take, cursor});
  }

  /** Read a source for a team */
  @Get(':id')
  @Scopes('team-{teamId}:read-source-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id') id: string
  ): Promise<Stripe.Source> {
    return this.stripeService.getSource(teamId, id);
  }

  /** Delete a source for a team */
  @Delete(':id')
  @AuditLog('delete-source')
  @Scopes('team-{teamId}:delete-source-{id}')
  async remove(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id') id: string
  ): Promise<{success: true}> {
    await this.stripeService.deleteSource(teamId, id);
    return {success: true};
  }
}
