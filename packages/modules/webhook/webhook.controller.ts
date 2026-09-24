import {Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query} from '@nestjs/common';
import {Prisma, Webhook} from '@generated/prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {CreateWebhookDto, ReplaceWebhookDto, UpdateWebhookDto} from './webhook.dto';
import {WebhookService} from './webhook.service';

@Controller('webhooks')
export class WebhookController {
  constructor(private webhookService: WebhookService) {}

  /** Create a webhook for a group */
  @Post()
  async create(@Param('teamId', ParseIntPipe) teamId: number, @Body() data: CreateWebhookDto): Promise<Webhook> {
    return this.webhookService.createWebhook({...data, teamId});
  }

  /** Get webhooks for a group */
  @Get()
  async getAll(
    @Query('skip') skip?: number,
    @Query('take') take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.WebhookWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Webhook[]> {
    return this.webhookService.getWebhooks({
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get webhook scopes for a group */
  @Get('scopes')
  async scopes(): Promise<Record<string, string>> {
    return this.webhookService.getWebhookScopes();
  }

  /** Get a webhook for a group */
  @Get(':id')
  async get(@Param('teamId', ParseIntPipe) teamId: number, @Param('id', ParseIntPipe) id: number): Promise<Webhook> {
    return this.webhookService.getWebhook(teamId, id);
  }

  /** Update a webhook for a group */
  @Patch(':id')
  async update(
    @Body() data: UpdateWebhookDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Webhook> {
    return this.webhookService.updateWebhook(teamId, id, data);
  }

  /** Replace a webhook for a group */
  @Put(':id')
  async replace(
    @Body() data: ReplaceWebhookDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Webhook> {
    return this.webhookService.updateWebhook(teamId, id, data);
  }

  /** Delete a webhook for a group */
  @Delete(':id')
  async remove(@Param('teamId', ParseIntPipe) teamId: number, @Param('id', ParseIntPipe) id: number): Promise<Webhook> {
    return this.webhookService.deleteWebhook(teamId, id);
  }
}
