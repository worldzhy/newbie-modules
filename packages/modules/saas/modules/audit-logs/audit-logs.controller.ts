import {Controller, Get, Query} from '@nestjs/common';
import {AuditLog, Prisma} from '@prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {Expose} from '../../helpers/interfaces';
import {Scopes} from '../auth/scope.decorator';
import {AuditLogsService} from './audit-logs.service';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private auditLogsService: AuditLogsService) {}

  /** Get audit logs for a team */
  @Get()
  @Scopes('audit-log-*:read-info')
  async getAll(
    @Query('skip', OptionalIntPipe) skip?: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.AuditLogWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<AuditLog>[]> {
    return this.auditLogsService.getAuditLogs({
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }
}
