import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {Domain, Prisma} from '@prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {Expose} from '../../helpers/interfaces';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {
  DOMAIN_VERIFICATION_HTML,
  DOMAIN_VERIFICATION_TXT,
} from './domains.constants';
import {CreateDomainDto} from './domains.dto';
import {DomainsService} from './domains.service';

@Controller('teams/:teamId/domains')
export class DomainController {
  constructor(private domainsService: DomainsService) {}

  /** Create a new domain for a team */
  @Post()
  @AuditLog('create-domain')
  @Scopes('team-{teamId}:write-domain-*')
  async create(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() data: CreateDomainDto
  ): Promise<Expose<Domain>> {
    return this.domainsService.createDomain(teamId, data);
  }

  /** Get domains for a team */
  @Get()
  @Scopes('team-{teamId}:read-domain-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query('skip', OptionalIntPipe) skip?: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.DomainWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<Domain>[]> {
    return this.domainsService.getDomains(teamId, {
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Read a domain for a team */
  @Get(':id')
  @Scopes('team-{teamId}:read-domain-{id}')
  async get(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Domain>> {
    return this.domainsService.getDomain(teamId, id);
  }

  /** Delete a domain for a team */
  @Delete(':id')
  @AuditLog('delete-domain')
  @Scopes('team-{teamId}:delete-domain-{id}')
  async remove(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Domain>> {
    return this.domainsService.deleteDomain(teamId, id);
  }

  /** Verify a domain using TXT record */
  @Post(':id/verify/txt')
  @AuditLog('verify-domain-txt')
  @Scopes('team-{teamId}:write-domain-{id}')
  async verifyTxt(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Domain>> {
    return this.domainsService.verifyDomain(
      teamId,
      id,
      DOMAIN_VERIFICATION_TXT
    );
  }

  /** Verify a domain using HTML file upload */
  @Post(':id/verify/html')
  @AuditLog('verify-domain-html')
  @Scopes('team-{teamId}:write-domain-{id}')
  async verifyHtml(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Domain>> {
    return this.domainsService.verifyDomain(
      teamId,
      id,
      DOMAIN_VERIFICATION_HTML
    );
  }
}
