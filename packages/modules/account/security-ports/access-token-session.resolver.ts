import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { UserStatus } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import {
  AccessTokenSessionResolver,
  ResolvedAccessTokenSession,
} from "@modules/security/ports/access-token-session.resolver";

/**
 * Account-side binding of security's AccessTokenSessionResolver port:
 * resolves a JWT access token to its live session row and enforces that the
 * owning user is still active.
 */
@Injectable()
export class AccountAccessTokenSessionResolver implements AccessTokenSessionResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(accessToken: string): Promise<ResolvedAccessTokenSession> {
    const session = await this.prisma.session.findFirst({
      where: { accessToken },
      select: { id: true, user: { select: { id: true, roles: true, status: true } } },
    });

    if (!session) {
      throw new UnauthorizedException("Invalid access token");
    }

    // Disabled/deleted users keep no valid access until re-enabled,
    // regardless of unexpired tokens issued earlier.
    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException("The account is not active.");
    }

    return { userId: session.user.id, sessionId: session.id, roles: session.user.roles };
  }
}
