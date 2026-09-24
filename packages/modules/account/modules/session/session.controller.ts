import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {ApiBearerAuth, ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {Prisma, Session} from '@generated/prisma/client';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {Expose, expose} from '../../helpers/expose';
import {SessionResponseDto, SessionsListRequestDto, SessionsListResponseDto} from './session.dto';
import {SESSION_NOT_FOUND, UNAUTHORIZED_RESOURCE} from '@devbie/newbie/exceptions/errors.constants';
import {UserRequest} from '../../account.interface';

@ApiTags('Account / Session')
@ApiBearerAuth()
@Controller('users/:userId/sessions')
export class SessionController {
  constructor(private prisma: PrismaService) {}

  /** Get sessions for a user */
  @Get()
  @ApiOperation({summary: 'Get sessions for a user'})
  @ApiResponse({type: SessionsListResponseDto})
  async getAll(
    @Req() req: UserRequest,
    @Param('userId') userId: string,
    @Query() query: SessionsListRequestDto
  ): Promise<SessionsListResponseDto> {
    const {sessionId} = req.user;
    const {page, pageSize} = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Session,
      pagination: {page, pageSize},
      findManyArgs: {
        where: {userId},
        orderBy: {id: 'desc'},
      },
    });

    result.records = result.records
      .map(session => expose<Session>(session))
      .map(session => ({
        ...session,
        isCurrentSession: sessionId === session.id,
      }));
    return result;
  }

  /** Get a session for a user */
  @Get(':id')
  @ApiOperation({summary: 'Get a session by id'})
  @ApiResponse({type: SessionResponseDto})
  async get(
    @Req() req: UserRequest,
    @Param('userId') userId: string,
    @Param('id') id: number
  ): Promise<Expose<Session & {isCurrentSession: boolean}>> {
    const {sessionId} = req.user;
    const session = await this.prisma.session.findUnique({where: {id, userId}});
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);
    if (session.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);

    return {
      ...expose<Session>(session),
      isCurrentSession: sessionId === session.id,
    };
  }

  /** Delete a session for a user */
  @Delete(':id')
  @ApiOperation({summary: 'Delete a session'})
  @ApiResponse({type: SessionResponseDto})
  async remove(@Param('userId') userId: string, @Param('id', ParseIntPipe) id: number): Promise<Expose<Session>> {
    const testSession = await this.prisma.session.findUnique({where: {id}});
    if (!testSession) throw new NotFoundException(SESSION_NOT_FOUND);
    if (testSession.userId !== userId) throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    const session = await this.prisma.session.delete({
      where: {id},
    });

    return expose<Session>(session);
  }
}
