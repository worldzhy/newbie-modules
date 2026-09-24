import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import {ApiTags, ApiResponse} from '@nestjs/swagger';
import {Prisma, Session} from '@prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {expose} from '../../helpers/expose';
import {Expose} from '../../helpers/interfaces';
import {UserRequest} from '../auth/auth.interface';
import {Scopes} from '../auth/scope.decorator';
import {SessionsService} from './sessions.service';
import {SessionsListResDto, SessionsListReqDto} from './sessions.dto';

@ApiTags('Users Session')
@Controller('users/:userId/sessions')
export class SessionController {
  constructor(
    private prisma: PrismaService,
    private sessionsService: SessionsService
  ) {}

  /** Get sessions for a user */
  @Get()
  @ApiResponse({type: SessionsListResDto})
  @Scopes('user-{userId}:read-session-*')
  async getAll(
    @Req() req: UserRequest,
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: SessionsListReqDto
  ): Promise<SessionsListResDto> {
    const {sessionId} = req.user;
    const {page, pageSize} = query;
    const sessions = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Session,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {userId},
        orderBy: {id: 'desc'},
      },
    });
    sessions.records = sessions.records
      .map(user => expose<Session>(user))
      .map(i => ({...i, isCurrentSession: sessionId === i.id}));
    return sessions;
  }

  /** Get a session for a user */
  @Get(':id')
  @Scopes('user-{userId}:read-session-{id}')
  async get(
    @Req() req: UserRequest,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Session>> {
    const {userId} = req.user;
    return this.sessionsService.getSession(
      userId as number,
      id,
      req.user?.sessionId
    );
  }

  /** Delete a session for a user */
  @Delete(':id')
  @Scopes('user-{userId}:delete-session-{id}')
  async remove(
    @Req() req: UserRequest,
    @Param('id', ParseIntPipe) id: number
  ): Promise<Expose<Session>> {
    const {userId} = req.user;
    return this.sessionsService.deleteSession(userId as number, id);
  }
}
