import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { compareHash } from "@devbie/newbie/utilities/common.util";
import { INVALID_CREDENTIALS, API_KEY_NOT_FOUND } from "@devbie/newbie/exceptions/errors.constants";
import { ApiKeyVerifier } from "@modules/security/ports/api-key.verifier";

/**
 * Account-side binding of security's ApiKeyVerifier port: looks up the stored
 * API key and compares the presented secret against its hash.
 */
@Injectable()
export class AccountApiKeyVerifier implements ApiKeyVerifier {
  constructor(private readonly prisma: PrismaService) {}

  async verify(key: string, secret: string): Promise<boolean> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { key },
    });
    if (!apiKey) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    const match = await compareHash(secret, apiKey.secret);
    if (match !== true) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return true;
  }
}
