import {Controller, Get, Param, Query} from '@nestjs/common';
import {Prisma} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {AuditLogListResponseDto} from './audit-log.dto';

@ApiTags('Account / Audit Log')
@ApiBearerAuth()
@Controller()
export class AuditLogController {
  constructor(private prisma: PrismaService) {}

  /** Get audit logs for a team */
  @Get('organizations/:organizationId/audit-logs')
  @ApiOperation({summary: 'Get audit logs for an organization'})
  @ApiResponse({type: AuditLogListResponseDto})
  async getAuditLogsByOrganization(
    @Param('organizationId') organizationId: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number
  ) {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.AuditLog,
      pagination: {page, pageSize},
      findManyArgs: {where: {organizationId}, orderBy: {id: 'desc'}},
    });
  }

  /** Get audit logs for a user */
  @Get('users/:userId/audit-logs')
  @ApiOperation({summary: 'Get audit logs for a user'})
  @ApiResponse({type: AuditLogListResponseDto})
  async getAuditLogsByUser(
    @Param('userId') userId: string,
    @Query('page') page: number,
    @Query('pageSize') pageSize: number
  ) {
    return await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.AuditLog,
      pagination: {page, pageSize},
      findManyArgs: {where: {userId}, orderBy: {id: 'desc'}},
    });
  }
}
