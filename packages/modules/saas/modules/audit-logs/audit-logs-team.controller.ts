import {Controller, Get, Param, ParseIntPipe, Query} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {AuditLog, Prisma} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {expose} from '../../helpers/expose';
import {Scopes} from '../auth/scope.decorator';
import {AuditLogsListReqDto, AuditLogsListResDto} from './audit-logs.dto';

@ApiTags('Teams Audit Logs')
@Controller('teams/:teamId/audit-logs')
export class AuditLogTeamController {
  constructor(private prisma: PrismaService) {}

  /** Get audit logs for a team */
  @Get()
  @Scopes('team-{teamId}:read-audit-log-*')
  async getAll(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Query() query: AuditLogsListReqDto
  ): Promise<AuditLogsListResDto> {
    const {page, pageSize} = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.AuditLog,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {teamId},
        orderBy: {id: 'desc'},
        include: {team: true, user: true},
      },
    });

    result.records = result.records.map(item => expose<AuditLog>(item));
    return result;
  }
}
