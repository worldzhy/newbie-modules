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
  UseGuards,
  Req,
} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {ApiKey, Prisma} from '@prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {SaasAuthGuard} from '@/microservices/saas/modules/auth/guards/auth.guard';
import {Expose} from '../../helpers/interfaces';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {
  CreateApiKeyDto,
  ReplaceApiKeyDto,
  UpdateApiKeyDto,
} from './api-keys.dto';
import {ApiKeysService} from './api-keys.service';

@ApiTags('Teams Api-keys')
@Controller('teams/:teamId/api-keys')
export class ApiKeyTeamController {
  constructor(private apiKeysService: ApiKeysService) {}

  /** Create an API key for a team */
  @Post()
  @AuditLog('create-api-key')
  @UseGuards(SaasAuthGuard)
  @Scopes('team-{teamId}:write-api-key-*')
  async create(
    @Req() req,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: CreateApiKeyDto
  ): Promise<Expose<ApiKey>> {
    const {userId} = req.user;
    return this.apiKeysService.createApiKeyForTeam(teamId, userId, data);
  }

  /** Get API keys for a team */
  @Get()
  @Scopes('team-{teamId}:read-api-key-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query('skip', OptionalIntPipe) skip?: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.ApiKeyWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<ApiKey>[]> {
    return this.apiKeysService.getApiKeysForTeam(teamId, {
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get API key scopes for a team */
  @Get('scopes')
  @Scopes('team-{teamId}:write-api-key-*')
  async scopes(
    @Param('teamId', ParseIntPipe) teamId: number
  ): Promise<Record<string, string>> {
    return this.apiKeysService.getApiKeyScopesForTeamCustomized(teamId);
  }

  /** Get an API key */
  @Get(':id')
  @Scopes('team-{teamId}:read-api-key-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<ApiKey>> {
    return this.apiKeysService.getApiKeyForTeam(teamId, id);
  }

  /** Update an API key */
  @Patch(':id')
  @AuditLog('update-api-key')
  @Scopes('team-{teamId}:write-api-key-{id}')
  async update(
    @Body() data: UpdateApiKeyDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<ApiKey>> {
    return this.apiKeysService.updateApiKeyForTeam(teamId, id, data);
  }

  /** Replace an API key */
  @Put(':id')
  @AuditLog('update-api-key')
  @Scopes('team-{teamId}:write-api-key-{id}')
  async replace(
    @Body() data: ReplaceApiKeyDto,
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<ApiKey>> {
    return this.apiKeysService.updateApiKeyForTeam(teamId, id, data);
  }

  /** Delete an API key */
  @Delete(':id')
  @AuditLog('delete-api-key')
  @Scopes('team-{teamId}:delete-api-key-{id}')
  async remove(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<ApiKey>> {
    return this.apiKeysService.deleteApiKeyForTeam(teamId, id);
  }

  /** Get logs for an API key */
  @Get(':id/logs')
  @Scopes('team-{teamId}:read-api-key-logs-*')
  async getLogs(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Record<string, number | string>,
    @Query('where', WherePipe) where?: Record<string, number | string>
  ): Promise<Record<string, any>[]> {
    return this.apiKeysService.getApiKeyLogsForTeam(teamId, id, {
      take,
      cursor,
      where,
    });
  }
}
