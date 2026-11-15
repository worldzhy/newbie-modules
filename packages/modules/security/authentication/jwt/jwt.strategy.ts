import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import { Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { TokenSubject } from "../../token/token.constants";
import { ACCESS_TOKEN_SESSION_RESOLVER, AccessTokenSessionResolver } from "../../ports/access-token-session.resolver";

/** Bearer extractor shared by the passport option and validate(). */
const extractBearerToken = ExtractJwt.fromAuthHeaderAsBearerToken();

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(ACCESS_TOKEN_SESSION_RESOLVER)
    private readonly sessionResolver?: AccessTokenSessionResolver,
  ) {
    const tokenConfig = config.getOrThrow<{
      defaultSecret: string;
      userAccess: { secret: string };
    }>("modules.security.token");

    super({
      jwtFromRequest: extractBearerToken,
      ignoreExpiration: false,
      passReqToCallback: true, // Pass request via the first parameter of validate
      secretOrKey: tokenConfig.userAccess.secret || tokenConfig.defaultSecret,
      // Access tokens are the only subject accepted here. When userAccess and
      // userRefresh both fall back to defaultSecret, the subject is the only
      // discriminator between the two token kinds, so passport must enforce it.
      jsonWebTokenOptions: { subject: TokenSubject.USER_ACCESS_TOKEN },
    });
  }

  /**
   * Called by passport only after the signature, the expiry and the access-token
   * subject have all been verified, so this resolves the live session rather
   * than re-verifying the token.
   *
   * The live session/role lookup is delegated to the identity provider via
   * the AccessTokenSessionResolver port: security must not know session tables.
   */
  async validate(req: Request) {
    // A request without a bearer token never reaches validate(): passport fails
    // it first and JwtAuthGuard reports that as Session_Missing (1105). An
    // empty extraction here therefore means the strategy and its extractor
    // disagree — a wiring bug, not a client error.
    const accessToken = extractBearerToken(req);
    if (!accessToken) {
      throw new InternalServerErrorException("JWT strategy ran without a bearer token");
    }

    if (!this.sessionResolver) {
      throw new InternalServerErrorException(
        "JWT authentication is active but no ACCESS_TOKEN_SESSION_RESOLVER is bound. Did the identity provider module load?",
      );
    }

    const session = await this.sessionResolver.resolve(accessToken);

    // Unified request.user shape across every authenticated strategy:
    // { userId, sessionId, roles }. userId comes from the resolved session row
    // so the token payload cannot disagree with the stored identity.
    return { userId: session.userId, sessionId: session.sessionId, roles: session.roles };
  }
}
