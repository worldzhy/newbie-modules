import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GeolocationService } from "@modules/audit/helpers/geolocation.service";
import { UAParser } from "ua-parser-js";
import { SESSION_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { secondsUntilUnixTimestamp } from "@devbie/newbie/utilities/datetime.util";
import { TokenService } from "@modules/security/token/token.service";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";

/**
 * A retried refresh of the same token within this window is treated as an
 * idempotent replay and returns the already-minted token pair, so a dropped
 * response or a double-fetch from two tabs does not look like token theft.
 * Outside the window the same token is a genuine reuse and the session is
 * revoked (ADR-034).
 */
const REFRESH_IDEMPOTENCY_WINDOW_MS = 30_000;

/**
 * Session rows never store the plaintext refresh token; only callers of
 * generate()/refresh() receive the raw credential. We attach it to the
 * returned record so existing callers that read `session.refreshToken` keep
 * working without type churn.
 */
type SessionWithCredentials = Prisma.SessionGetPayload<object> & { refreshToken: string };

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geolocationService: GeolocationService,
    private readonly tokenService: TokenService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async generate(params: { ipAddress: string; userAgent: string; userId: string }): Promise<SessionWithCredentials> {
    return this.generateWithTransaction(this.prisma, params);
  }

  async generateWithTransaction(
    tx: Prisma.TransactionClient,
    params: { ipAddress: string; userAgent: string; userId: string },
  ): Promise<SessionWithCredentials> {
    const ua = new UAParser(params.userAgent);
    const location = await this.geolocationService.getLocation(params.ipAddress);
    const refreshToken = this.tokenService.signUserRefreshToken({ userId: params.userId });
    const session = await tx.session.create({
      data: {
        accessToken: this.tokenService.signUserAccessToken({
          userId: params.userId,
        }),
        refreshTokenHash: this.tokenService.hashToken(refreshToken),
        previousRefreshTokenHash: null,
        rotatedAt: null,
        refreshTokenNext: null,
        ipAddress: params.ipAddress,
        city: location?.city?.names?.en,
        region: location?.subdivisions?.pop()?.names?.en,
        timezone: location?.location?.time_zone,
        countryCode: location?.country?.iso_code,
        userAgent: params.userAgent,
        browser: `${ua.getBrowser().name ?? ""} ${ua.getBrowser().version ?? ""}`.trim() || undefined,
        operatingSystem:
          `${ua.getOS().name ?? ""} ${ua.getOS().version ?? ""}`.replace("Mac OS", "macOS").trim() || undefined,
        userId: params.userId,
      },
    });
    return { ...session, refreshToken };
  }

  async refresh(refreshToken: string): Promise<SessionWithCredentials> {
    // [step 1] Validate the JWT signature (forgery / expiry). This also gives
    // us the userId and the original expiry so the new token inherits it.
    const refreshTokenInfo = this.tokenService.verifyUserRefreshToken(refreshToken);
    const tokenHash = this.tokenService.hashToken(refreshToken);

    // [step 2] CAS-rotate: only the row currently holding this hash wins. A
    // concurrent or replayed refresh sees count === 0 and falls through to the
    // idempotency / reuse handling below.
    const newAccessToken = this.tokenService.signUserAccessToken({ userId: refreshTokenInfo.userId });
    const newRefreshToken = this.tokenService.signUserRefreshToken(
      { userId: refreshTokenInfo.userId },
      { expiresIn: secondsUntilUnixTimestamp(refreshTokenInfo.exp) },
    );
    const newHash = this.tokenService.hashToken(newRefreshToken);

    const rotation = await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash },
      data: {
        accessToken: newAccessToken,
        refreshTokenHash: newHash,
        previousRefreshTokenHash: tokenHash,
        refreshTokenNext: newRefreshToken,
        rotatedAt: new Date(),
      },
    });

    if (rotation.count === 1) {
      // Re-fetch so the returned record carries the rotated fields.
      const session = await this.prisma.session.findUniqueOrThrow({
        where: { refreshTokenHash: newHash },
      });
      return { ...session, refreshToken: newRefreshToken };
    }

    // [step 3] count === 0: the token was already rotated (or never existed).
    // Look for it as the previous hash of a session rotated within the window.
    const rotatedSession = await this.prisma.session.findFirst({
      where: { previousRefreshTokenHash: tokenHash },
    });

    if (
      rotatedSession &&
      rotatedSession.rotatedAt &&
      Date.now() - rotatedSession.rotatedAt.getTime() < REFRESH_IDEMPOTENCY_WINDOW_MS
    ) {
      // Idempotent replay: the caller is retrying the same rotation. Return the
      // token pair we already minted.
      return { ...rotatedSession, refreshToken: rotatedSession.refreshTokenNext as string };
    }

    // [step 4] Genuine reuse (or a token from a session long-since rotated).
    // Revoke only the offending session — not every session the owner has —
    // and audit the event.
    if (rotatedSession) {
      await this.prisma.session.delete({ where: { id: rotatedSession.id } }).catch(() => undefined);
      await this.auditLogService.record(AuditEvent.SESSION_REVOKED, {
        actorType: AuditActorType.USER,
        actorId: rotatedSession.userId,
        resourceType: "session",
        detail: { reason: "refresh_token_reuse", sessionId: rotatedSession.id },
      });
    }
    throw new UnauthorizedException(SESSION_NOT_FOUND);
  }

  async destroy(token: string) {
    // Match by access token or by the hash of a submitted refresh token. The
    // plaintext is never stored, so a refresh token must be hashed before
    // lookup.
    const tokenHash = this.tokenService.hashToken(token);
    const session = await this.prisma.session.findFirst({
      where: { OR: [{ accessToken: token }, { refreshTokenHash: tokenHash }] },
      select: { id: true, user: { select: { id: true } } },
    });
    // Destroy is idempotent: a missing session is already in the desired end
    // state, and a concurrent destroy may win the race between findFirst and
    // delete, so a missing-row error (P2025) is also a success.
    if (!session) return;

    try {
      await this.prisma.session.delete({
        where: { id: session.id },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
      throw error;
    }
  }
}
