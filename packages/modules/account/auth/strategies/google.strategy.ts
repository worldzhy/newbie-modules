import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-google-oauth20";
import { GoogleUserReqDto, GoogleUserResDto } from "@modules/security/authentication/google-oauth/dto/google-user.dto";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(private readonly config: ConfigService) {
    const clientID = config.getOrThrow<string>("modules.account.googleAuth.clientId");
    const clientSecret = config.getOrThrow<string>("modules.account.googleAuth.clientSecret");
    const callbackURL = config.getOrThrow<string>("modules.account.googleAuth.callbackURL");

    super({
      clientID: clientID,
      clientSecret: clientSecret,
      callbackURL: callbackURL,
      scope: ["email", "profile"],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: GoogleUserReqDto): Promise<GoogleUserResDto> {
    const { emails, photos, id, displayName, provider } = profile;
    // The email scope was requested, so a profile without email means the
    // handshake cannot establish an account identity.
    const email = emails?.[0]?.value;
    if (!email) {
      throw new UnauthorizedException("Google did not return an email address.");
    }
    const user: GoogleUserResDto = {
      id,
      email,
      displayName: displayName,
      picture: photos?.[0]?.value ?? "",
      provider,
    };
    return user;
  }
}
