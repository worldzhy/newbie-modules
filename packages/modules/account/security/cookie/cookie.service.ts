import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {CookieOptions, Response} from 'express';
import {TokenService} from '../token/token.service';
import {dateOfUnixTimestamp} from '@devbie/newbie/utilities/datetime.util';

export enum CookieName {
  REFRESH_TOKEN = 'refreshToken',
}

@Injectable()
export class CookieService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenService: TokenService
  ) {}

  generateForRefreshToken(refreshToken: string) {
    const refreshTokenInfo = this.tokenService.verifyUserRefreshToken(refreshToken);

    return this.generate({
      name: CookieName.REFRESH_TOKEN,
      value: refreshToken,
      expires: dateOfUnixTimestamp(refreshTokenInfo.exp),
    });
  }

  generate(params: {name: CookieName; value: string; expires: Date}) {
    return {
      name: params.name,
      value: params.value,
      options: {
        ...this.defaultCookieOptions(),
        expires: params.expires,
      },
    };
  }

  set(response: Response, cookie: {name: string; value: string; options: CookieOptions}) {
    response.cookie(cookie.name, cookie.value, cookie.options);
  }

  clear(response: Response, cookieName: CookieName) {
    response.clearCookie(cookieName, this.defaultCookieOptions());
  }

  defaultCookieOptions(): CookieOptions {
    const frontendUrl = this.config.getOrThrow<string>('framework.app.frontendUrl');

    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: frontendUrl.startsWith('https') ? true : false,
    };
  }
}
