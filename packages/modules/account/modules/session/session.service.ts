import { Injectable } from "@nestjs/common";
import { Prisma } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { GeolocationService } from "@modules/audit/helpers/geolocation.service";
import { UAParser } from "ua-parser-js";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
import { secondsUntilUnixTimestamp } from "@devbie/newbie/utilities/datetime.util";
import { TokenService } from "@modules/security/token/token.service";
import { AuditActorType, AuditEvent, AuditLogService } from "@modules/audit/audit-log.service";

/**
 * A retried refresh of the same token within this window is treated as an
 * idempotent replay and returns the already-minted token pair, so a dropped
 * response or a double-fetch from two tabs does not look like token theft.
 * Outside the window the same token is a genuine reuse and the session is
 * revoked (nightwatch-backend ADR-034).
 */
const REFRESH_IDEMPOTENCY_WINDOW_MS = 30_000;

/**
 * Session rows never store a usable credential: the refresh token is kept as a
 * hash (only the caller receives the plaintext) and the access token is signed
 * on demand with the row id as its `sid` claim, never written back (devbie
 * ADR-051). Both are attached to the returned record so callers read one object.
 */
type SessionWithCredentials = Prisma.SessionGetPayload<object> & {
  accessToken: string;
  refreshToken: string;
};

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
        refreshTokenHash: this.tokenService.hashToken(refreshToken),
        previousRefreshTokenHash: null,
        rotatedAt: null,
        refreshTokenNextSealed: null,
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
    // The id only exists after the insert, so the access token that names this
    // session is signed afterwards and never stored (ADR-051).
    return { ...session, accessToken: this.mintAccessToken(session), refreshToken };
  }

  async refresh(refreshToken: string): Promise<SessionWithCredentials> {
    // [step 1] Validate the JWT signature (forgery / expiry). This also gives
    // us the userId and the original expiry so the new token inherits it.
    const refreshTokenInfo = this.tokenService.verifyUserRefreshToken(refreshToken);
    const tokenHash = this.tokenService.hashToken(refreshToken);

    // [step 2] CAS-rotate: only the row currently holding this hash wins. A
    // concurrent or replayed refresh sees count === 0 and falls through to the
    // idempotency / reuse handling below.
    const newRefreshToken = this.tokenService.signUserRefreshToken(
      { userId: refreshTokenInfo.userId },
      { expiresIn: secondsUntilUnixTimestamp(refreshTokenInfo.exp) },
    );
    const newHash = this.tokenService.hashToken(newRefreshToken);

    const rotation = await this.prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash },
      data: {
        refreshTokenHash: newHash,
        previousRefreshTokenHash: tokenHash,
        refreshTokenNextSealed: this.tokenService.sealToken(newRefreshToken),
        rotatedAt: new Date(),
      },
    });

    if (rotation.count === 1) {
      // Re-fetch so the returned record carries the rotated fields.
      const session = await this.prisma.session.findUniqueOrThrow({
        where: { refreshTokenHash: newHash },
      });
      return { ...session, accessToken: this.mintAccessToken(session), refreshToken: newRefreshToken };
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
      // token pair we already minted, unsealing the credential held for exactly
      // this window.
      if (!rotatedSession.refreshTokenNextSealed) {
        throw new NewbieException(NewbieExceptionType.Session_RefreshRejected);
      }
      return {
        ...rotatedSession,
        accessToken: this.mintAccessToken(rotatedSession),
        refreshToken: this.tokenService.openSealedToken(rotatedSession.refreshTokenNextSealed),
      };
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
    throw new NewbieException(NewbieExceptionType.Session_RefreshRejected);
  }

  /**
   * Revoke a session by id. Revocation is row absence: every access token that
   * names this session fails authentication on its next request (devbie
   * ADR-051), and its refresh token stops rotating.
   */
  async revokeSession(sessionId: number) {
    try {
      await this.prisma.session.delete({ where: { id: sessionId } });
    } catch (error) {
      // Idempotent: a missing session is already in the desired end state, and a
      // concurrent revoke may win the race, so a missing-row error (P2025) is
      // also a success.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
      throw error;
    }
  }

  /**
   * Revoke the session holding a refresh token, and report which generation
   * matched. The plaintext is never stored, so the token must be hashed first.
   *
   * Both options exist for logout only. `allowPrevious`: a rotation response
   * that is still in flight (or was dropped) leaves the browser holding the
   * previous generation while the row already moved on; matching only the
   * current hash would make that logout a silent no-op. `auditReason`: logout
   * is a user-initiated revoke and is audited, while the refresh-token
   * strategy's routine expiry path stays unrecorded.
   */
  async revokeByRefreshToken(
    refreshToken: string,
    options: { allowPrevious?: boolean; auditReason?: string } = {},
  ): Promise<"current" | "previous" | "none"> {
    const tokenHash = this.tokenService.hashToken(refreshToken);
    const session = await this.prisma.session.findFirst({
      where: options.allowPrevious
        ? { OR: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }] }
        : { refreshTokenHash: tokenHash },
      select: { id: true, userId: true, refreshTokenHash: true },
    });
    if (!session) return "none";

    await this.revokeSession(session.id);
    const matched = session.refreshTokenHash === tokenHash ? "current" : "previous";
    if (options.auditReason) {
      await this.auditLogService.record(AuditEvent.SESSION_REVOKED, {
        actorType: AuditActorType.USER,
        actorId: session.userId,
        resourceType: "session",
        detail: { reason: options.auditReason, sessionId: session.id, matched },
      });
    }
    return matched;
  }

  private mintAccessToken(session: { id: number; userId: string }) {
    return this.tokenService.signUserAccessToken({ userId: session.userId, sessionId: session.id });
  }
}
