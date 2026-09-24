import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {Strategy} from 'passport-custom';
import {Request} from 'express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {API_KEY_NOT_FOUND, INVALID_CREDENTIALS} from '@devbie/newbie/exceptions/errors.constants';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'custom.api-key') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /**
   * 'validate' function must be implemented.
   */
  async validate(req: Request): Promise<boolean> {
    // [step 1] Guard statement.
    // const keyAndSecret = req.body;

    // const {key, secret}: {key: string; secret: string} = keyAndSecret;
    const key = req.headers['key'] as string;
    const secret = req.headers['secret'] as string;
    if (!key || !secret) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    // [step 2] Get api key.
    const apiKey = await this.prisma.apiKey.findUnique({
      where: {key},
    });
    if (!apiKey) {
      throw new UnauthorizedException(API_KEY_NOT_FOUND);
    }

    // [step 3] Validate secret.
    // const match = await compareHash(secret, apiKey.secret);
    // if (match !== true) {
    //   throw new UnauthorizedException(INVALID_CREDENTIALS);
    // }
    if (secret !== apiKey.secret) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return true;
  }
}
