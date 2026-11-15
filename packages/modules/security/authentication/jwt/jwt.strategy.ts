import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { NewbieException, NewbieExceptionType } from "@devbie/newbie/exceptions/newbie.exception";
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
      userAccess: { secret: string };
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
      // No credential at all (ADR-048 §3, 1105): distinct from an account that
      // was deleted (1101) and from a revoked session (1104), so clients and
      // metrics can tell "the caller sent nothing" apart from "the caller's
      // session died".
      throw new NewbieException(NewbieExceptionType.Session_Missing);
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
