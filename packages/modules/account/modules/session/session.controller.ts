import { Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { ListSessionsRequestDto, ListSessionsResponseDto, SessionResponseDto } from "./session.dto";
import { SESSION_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { UserRequest } from "@modules/security/security.interface";
import { RequireOwner } from "@modules/security/authorization/require-owner.decorator";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";

/**
 * Columns a session API may return. A Session row also holds the live access
 * token, the current and previous refresh-token hashes, and the plaintext
 * `refreshTokenNext` retained for the idempotency window; selecting the row
 * wholesale would hand those credentials to the caller. Every endpoint below
 * projects through this select so token material never leaves the database.
 */
const SESSION_PUBLIC_SELECT = {
  id: true,
  ipAddress: true,
  userAgent: true,
  city: true,
  region: true,
  timezone: true,
  countryCode: true,
  browser: true,
  operatingSystem: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
} satisfies Prisma.SessionSelect;

type SessionPublic = Prisma.SessionGetPayload<{ select: typeof SESSION_PUBLIC_SELECT }>;

@ApiTags("Account / Session")
@ApiBearerAuth()
@RequireOwner()
@Controller("users/:userId/sessions")
export class SessionController {
  constructor(
    private prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** Get sessions for a user */
  @Get()
  @ApiOperation({ summary: "Get sessions for a user" })
  @ApiResponse({ type: ListSessionsResponseDto })
  async list(
    @Req() req: UserRequest,
    @Param("userId") userId: string,
    @Query() query: ListSessionsRequestDto,
  ): Promise<ListSessionsResponseDto> {
    const { sessionId } = req.user;
    const { page, pageSize } = query;
    const result = await this.prisma.findManyInManyPages({
      model: Prisma.ModelName.Session,
      pagination: { page, pageSize },
      findManyArgs: {
        where: { userId },
        orderBy: { id: "desc" },
        select: SESSION_PUBLIC_SELECT,
      },
    });

    result.records = (result.records as SessionPublic[]).map((session) => ({
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
  ): Promise<SessionPublic & { isCurrentSession: boolean }> {
    const { sessionId } = req.user;
    // The where clause already scopes the row to the path user; SelfOnlyGuard
    // has verified the caller may act as that user.
    const session = await this.prisma.session.findUnique({
      where: { id, userId },
      select: SESSION_PUBLIC_SELECT,
    });
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);

    return {
      ...session,
      isCurrentSession: sessionId === id,
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
  ): Promise<SessionPublic> {
    // Guard already verified ownership; keep the lookup so a missing id
    // returns 404 instead of a Prisma delete error.
    const existing = await this.prisma.session.findUnique({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new NotFoundException(SESSION_NOT_FOUND);
    const session = await this.prisma.session.delete({
      where: { id },
      select: SESSION_PUBLIC_SELECT,
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

    return session;
  }
}
