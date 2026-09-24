import {Injectable, UnauthorizedException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {PassportStrategy} from '@nestjs/passport';
import {ExtractJwt, Strategy} from 'passport-jwt';
import {Request} from 'express';
import {PrismaService} from '@devbie/newbie/prisma/prisma.service';
import {TokenService} from '../../token/token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService
  ) {
    const tokenConfig = config.getOrThrow<{
      defaultSecret: string;
      userAccess: {secret: string; expiresIn: string | number};
    }>('microservices.account.token');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true, // Pass request via the first parameter of validate
      secretOrKey: tokenConfig.userAccess.secret || tokenConfig.defaultSecret,
    });
  }

  /**
   * 'vaidate' function will be called after the token in the http request passes the verification.
   *
   * For the jwt-strategy, Passport first verifies the JWT's signature and decodes the JSON.
   * Then it invokes our validate() method passing the decoded JSON as its single parameter
   */
  async validate(req: Request, payload: {userId: string; sub: string; iat: number; exp: number}) {
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);
    if (!accessToken) {
      throw new UnauthorizedException('No access token');
    }

    const accessTokenInfo = this.tokenService.verifyUserAccessToken(accessToken);

    const session = await this.prisma.session.findFirst({
      where: {accessToken},
      select: {user: {select: {id: true, roles: true}}},
    });

    if (session) {
      return {id: accessTokenInfo.userId, roles: session.user.roles};
    } else {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
