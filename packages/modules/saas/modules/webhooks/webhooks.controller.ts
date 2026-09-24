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
  Query,
} from '@nestjs/common';
import {Prisma, Webhook} from '@prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {Expose} from '../../helpers/interfaces';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {
  CreateWebhookDto,
  ReplaceWebhookDto,
  UpdateWebhookDto,
} from './webhooks.dto';
import {WebhooksService} from './webhooks.service';

@Controller('teams/:teamId/webhooks')
export class WebhookController {
  constructor(private webhooksService: WebhooksService) {}

  /** Create a webhook for a team */
  @Post()
  @AuditLog('create-webhook')
  @Scopes('team-{teamId}:write-webhook-*')
  async create(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: CreateWebhookDto
  ): Promise<Expose<Webhook>> {
    return this.webhooksService.createWebhook(teamId, data);
  }

  /** Get webhooks for a team */
  @Get()
  @Scopes('team-{teamId}:read-webhook-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query('skip', OptionalIntPipe) skip?: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.WebhookWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<Webhook>[]> {
    return this.webhooksService.getWebhooks(teamId, {
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get webhook scopes for a team */
  @Get('scopes')
  @Scopes('team-{teamId}:write-webhook-*')
  async scopes(): Promise<Record<string, string>> {
    return this.webhooksService.getWebhookScopes();
  }

  /** Get a webhook for a team */
  @Get(':id')
  @Scopes('team-{teamId}:read-webhook-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Webhook>> {
    return this.webhooksService.getWebhook(teamId, id);
  }

  /** Update a webhook for a team */
  @Patch(':id')
  @AuditLog('update-webhook')
  @Scopes('team-{teamId}:write-webhook-{id}')
  async update(
    @Body() data: UpdateWebhookDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Webhook>> {
    return this.webhooksService.updateWebhook(teamId, id, data);
  }

  /** Replace a webhook for a team */
  @Put(':id')
  @AuditLog('update-webhook')
  @Scopes('team-{teamId}:write-webhook-{id}')
  async replace(
    @Body() data: ReplaceWebhookDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Webhook>> {
    return this.webhooksService.updateWebhook(teamId, id, data);
  }

  /** Delete a webhook for a team */
  @Delete(':id')
  @AuditLog('delete-webhook')
  @Scopes('team-{teamId}:delete-webhook-{id}')
  async remove(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Webhook>> {
    return this.webhooksService.deleteWebhook(teamId, id);
  }
}
