import { Injectable, UnauthorizedException } from "@nestjs/common";
import { UserStatus } from "@generated/prisma/client";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import {
  INVALID_CREDENTIALS,
  API_KEY_NOT_FOUND,
  UNAUTHORIZED_RESOURCE,
} from "@devbie/newbie/exceptions/errors.constants";
import { ApiKeyVerifier, ApiKeyRequestContext } from "@modules/security/ports/api-key.verifier";
import {
  matchesIpRestriction,
  matchesReferrerRestriction,
  normalizeRestrictions,
} from "../modules/api-key/api-key-restrictions";

/**
 * Account-side binding of security's ApiKeyVerifier port: looks up the stored
 * API key, enforces that a personal key's owner is still active, compares the
 * presented secret against its hash, and applies the key's stored network
 * restrictions.
 *
 * This is the only real verification path (`ApiKeyStrategy` calls it), so the
 * owner and restriction checks live here rather than in a cache helper nothing
 * calls (N-1).
 */
@Injectable()
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided -- bound via the API_KEY_VERIFIER useClass provider
export class AccountApiKeyVerifier implements ApiKeyVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(key: string, secret: string, context?: ApiKeyRequestContext): Promise<boolean> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { key },
    });
    if (!apiKey) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    // A key is only usable while its owning user is ACTIVE. `userId` is a
    // required relation column, so this check always runs.
    const owner = await this.prisma.user.findUnique({ where: { id: apiKey.userId } });
    if (!owner || owner.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    }

    const match = await compareHash(secret, apiKey.secret);
    if (match !== true) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Restrictions are evaluated after the secret match, so a caller without
    // the credential cannot learn which addresses/origins the key allows.
    // Empty (or malformed-only) lists mean "no restriction" (R20-10). The IP
    // list is the network control; the referrer/origin list is a browser-side
    // misuse deterrent (both headers are client-set and forgeable), not an
    // access control.
    const ipRestrictions = normalizeRestrictions(apiKey.ipRestrictions);
    if (ipRestrictions.length > 0 && !matchesIpRestriction(context?.ipAddress, ipRestrictions)) {
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    }
    const referrerRestrictions = normalizeRestrictions(apiKey.referrerRestrictions);
    if (
      referrerRestrictions.length > 0 &&
      !matchesReferrerRestriction(context?.origin, context?.referrer, referrerRestrictions)
    ) {
      throw new UnauthorizedException(UNAUTHORIZED_RESOURCE);
    }

    return true;
  }
}
