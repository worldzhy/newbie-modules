import { Inject, Injectable, InternalServerErrorException, UnauthorizedException } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { TokenService } from "../../token/token.service";
import { ACCESS_TOKEN_SESSION_RESOLVER, AccessTokenSessionResolver } from "../../ports/access-token-session.resolver";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
    @Optional()
    @Inject(ACCESS_TOKEN_SESSION_RESOLVER)
    private readonly sessionResolver?: AccessTokenSessionResolver,
  ) {
    const tokenConfig = config.getOrThrow<{
      defaultSecret: string;
      userAccess: { secret: string; expiresIn: string | number };
    }>("modules.security.token");

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true, // Pass request via the first parameter of validate
      secretOrKey: tokenConfig.userAccess.secret || tokenConfig.defaultSecret,
    });
  }

  /**
   * 'validate' function will be called after the token in the http request passes the verification.
   *
   * For the jwt-strategy, Passport first verifies the JWT's signature and decodes the JSON.
   * Then it invokes our validate() passing the decoded JSON as a single parameter.
   *
   * The live session/role lookup is delegated to the identity provider via
   * the AccessTokenSessionResolver port: security must not know session tables.
   */
  async validate(req: Request) {
    const accessToken = this.tokenService.getTokenFromHttpRequest(req);
    if (!accessToken) {
      throw new UnauthorizedException("No access token");
    }

    const accessTokenInfo = this.tokenService.verifyUserAccessToken(accessToken);

    if (!this.sessionResolver) {
      throw new InternalServerErrorException(
        "JWT authentication is active but no ACCESS_TOKEN_SESSION_RESOLVER is bound. Did the identity provider module load?",
      );
    }

    const session = await this.sessionResolver.resolve(accessToken);

    // Unified request.user shape across every authenticated strategy:
    // { userId, sessionId, roles }.
    return { userId: accessTokenInfo.userId, sessionId: session.sessionId, roles: session.roles };
  }
}
