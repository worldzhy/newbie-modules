import { Injectable, UnauthorizedException } from "@nestjs/common";
import { UserStatus } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import {
  INVALID_CREDENTIALS,
  API_KEY_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from "@devbie/newbie/exceptions/errors.constants";
import { ApiKeyVerifier } from "@modules/security/ports/api-key.verifier";

/**
 * Account-side binding of security's ApiKeyVerifier port: looks up the stored
 * API key, enforces that a personal key's owner is still active, and compares
 * the presented secret against its hash.
 *
 * This is the only real verification path (`ApiKeyStrategy` calls it), so the
 * owner check lives here rather than in a cache helper nothing calls (N-1).
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- bound via the API_KEY_VERIFIER useClass provider
export class AccountApiKeyVerifier implements ApiKeyVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(key: string, secret: string): Promise<boolean> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { key },
    });
    if (!apiKey) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    // Personal keys are only usable while the owning user is ACTIVE. The Prisma
    // schema makes `userId` required today, so this check always runs; a
    // nullable owner for organization-scoped keys is not modelled yet (R6-12).
    if (apiKey.userId) {
      const owner = await this.prisma.user.findUnique({ where: { id: apiKey.userId } });
      if (!owner || owner.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
      }
    }

    const match = await compareHash(secret, apiKey.secret);
    if (match !== true) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return true;
  }
}
