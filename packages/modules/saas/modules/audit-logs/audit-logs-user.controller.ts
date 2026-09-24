import {Controller, Get, ParseIntPipe, Query, Param} from '@nestjs/common';
import {AuditLog, Prisma} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ApiTags, ApiResponse} from '@nestjs/swagger';
import {expose} from '../../helpers/expose';
import {Scopes} from '../auth/scope.decorator';
import {AuditLogsListReqDto, AuditLogsListResDto} from './audit-logs.dto';

@ApiTags('Users Audit Logs')
@Controller('users/:userId/audit-logs')
export class AuditLogUserController {
  constructor(private prisma: PrismaService) {}

  /** Get audit logs for a user */
  @Get()
  @ApiResponse({
    type: AuditLogsListResDto,
  })
  @Scopes('user-{userId}:read-audit-log-*')
  async getAll(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: AuditLogsListReqDto
  ): Promise<AuditLogsListResDto> {
    const {page, pageSize} = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.AuditLog,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {userId},
        orderBy: {id: 'desc'},
        include: {team: true, user: true},
      },
    });

    result.records = result.records.map(user => expose<AuditLog>(user));
    return result;
  }
}
