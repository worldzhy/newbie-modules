import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import {ApiTags} from '@nestjs/swagger';
import {Team, Prisma} from '@prisma/client';
import {CursorPipe} from '@devbie/newbie/pipes/cursor.pipe';
import {OptionalIntPipe} from '@devbie/newbie/pipes/optional-int.pipe';
import {OrderByPipe} from '@devbie/newbie/pipes/order-by.pipe';
import {SelectIncludePipe} from '@devbie/newbie/pipes/select-include.pipe';
import {WherePipe} from '@devbie/newbie/pipes/where.pipe';
import {Expose} from '../../helpers/interfaces';
import {AuditLog} from '../audit-logs/audit-log.decorator';
import {Scopes} from '../auth/scope.decorator';
import {ReplaceTeamDto, UpdateTeamDto} from './teams.dto';
import {TeamsService} from './teams.service';

@ApiTags('Teams')
@Controller('teams')
export class TeamController {
  constructor(private teamsService: TeamsService) {}

  /** Get teams */
  @Get()
  @Scopes('team-*:read-info')
  async getAll(
    @Query('skip', OptionalIntPipe) skip?: number,
    @Query('take', OptionalIntPipe) take?: number,
    @Query('cursor', CursorPipe) cursor?: Prisma.TeamWhereUniqueInput,
    @Query('where', WherePipe) where?: Record<string, number | string>,
    @Query('orderBy', OrderByPipe) orderBy?: Record<string, 'asc' | 'desc'>
  ): Promise<Expose<Team>[]> {
    return this.teamsService.getTeams({
      skip,
      take,
      orderBy,
      cursor,
      where,
    });
  }

  /** Get team details */
  @Get(':teamId')
  @Scopes('team-{teamId}:read-info')
  async get(
    @Param('teamId', ParseIntPipe) id: number,
    @Query('select', SelectIncludePipe) select?: Record<string, boolean>,
    @Query('include', SelectIncludePipe) include?: Record<string, boolean>
  ): Promise<Expose<Team>> {
    return this.teamsService.getTeam(id, {select, include});
  }

  /** Update a team */
  @Patch(':teamId')
  @AuditLog('update-info')
  @Scopes('team-{teamId}:write-info')
  async update(
    @Body() data: UpdateTeamDto,
    @Param('teamId', ParseIntPipe) id: number
  ): Promise<Expose<Team>> {
    return this.teamsService.updateTeam(id, data);
  }

  /** Replace a team */
  @Put(':teamId')
  @AuditLog('update-info')
  @Scopes('team-{teamId}:write-info')
  async replace(
    @Body() data: ReplaceTeamDto,
    @Param('teamId', ParseIntPipe) id: number
  ): Promise<Expose<Team>> {
    return this.teamsService.updateTeam(id, data);
  }

  /** Delete a team */
  @Delete(':teamId')
  @AuditLog('delete')
  @Scopes('team-{teamId}:delete')
  async remove(
    @Param('teamId', ParseIntPipe) id: number
  ): Promise<Expose<Team>> {
    return this.teamsService.deleteTeam(id);
  }
}
