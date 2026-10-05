import { Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Prisma, Session } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { Expose, expose } from "../../helpers/expose";
import { SessionResponseDto, SessionsListRequestDto, SessionsListResponseDto } from "./session.dto";
import { SESSION_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { UserRequest } from "@modules/security/security.interface";
import { SelfOnlyGuard } from "@modules/security/self-only/self-only.guard";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";

@ApiTags("Account / Session")
@ApiBearerAuth()
@UseGuards(SelfOnlyGuard)
@Controller("users/:userId/sessions")
export class SessionController {
  constructor(
    private prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Get sessions for a user */
  @Get()
  @ApiOperation({ summary: "Get sessions for a user" })
  @ApiResponse({ type: SessionsListResponseDto })
  async getAll(
    @Req() req: UserRequest,
    @Param("userId") userId: string,
    @Query() query: SessionsListRequestDto,
  ): Promise<SessionsListResponseDto> {
    const { sessionId } = req.user;
    const { page, pageSize } = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Session,
      pagination: { page, pageSize },
      findManyArgs: {
        where: { userId },
        orderBy: { id: "desc" },
      },
    });

    result.records = result.records
      .map((session) => expose<Session>(session))
      .map((session) => ({
        ...session,
        isCurrentSession: sessionId === session.id,
      }));
    return result;
  }

  /** Get a session for a user */
  @Get(":id")
  @ApiOperation({ summary: "Get a session by id" })
  @ApiResponse({ type: SessionResponseDto })
  async get(
    @Req() req: UserRequest,
    @Param("userId") userId: string,
    @Param("id") id: number,
  ): Promise<Expose<Session & { isCurrentSession: boolean }>> {
    const { sessionId } = req.user;
    // The where clause already scopes the row to the path user; SelfOnlyGuard
    // has verified the caller may act as that user.
    const session = await this.prisma.session.findUnique({ where: { id, userId } });
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);

    return {
      ...expose<Session>(session),
      isCurrentSession: sessionId === session.id,
    };
  }

  /** Revoke a session for a user */
  @Delete(":id")
  @ApiOperation({ summary: "Delete a session" })
  @ApiResponse({ type: SessionResponseDto })
  async remove(
    @Req() req: UserRequest,
    @Param("userId") userId: string,
    @Param("id", ParseIntPipe) id: number,
  ): Promise<Expose<Session>> {
    // Guard already verified ownership; keep the lookup so a missing id
    // returns 404 instead of a Prisma delete error.
    const testSession = await this.prisma.session.findUnique({ where: { id, userId } });
    if (!testSession) throw new NotFoundException(SESSION_NOT_FOUND);
    const session = await this.prisma.session.delete({
      where: { id },
    });

    await this.auditLogService.record(AuditEvent.SESSION_REVOKED, {
      actorType: AuditActorType.USER,
      actorId: req.user.userId,
      resourceType: "session",
      resourceId: String(id),
      detail: { sessionOwnerId: userId, isCurrentSession: req.user.sessionId === id },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return expose<Session>(session);
  }
}
