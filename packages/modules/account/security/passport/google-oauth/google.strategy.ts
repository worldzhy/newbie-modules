import {Injectable} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {Strategy} from 'passport-google-oauth20';
import {GoogleUserReqDto, GoogleUserResDto} from './dto/google-user.dto';
import {ConfigService} from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly config: ConfigService) {
    const clientID = config.getOrThrow<string>('microservices.account.googleAuth.clientId');
    const clientSecret = config.getOrThrow<string>('microservices.account.googleAuth.clientSecret');
    const callbackURL = config.getOrThrow<string>('microservices.account.googleAuth.callbackURL');

    super({
      clientID: clientID,
      clientSecret: clientSecret,
      callbackURL: callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: GoogleUserReqDto): Promise<GoogleUserResDto> {
    const {emails, photos, id, displayName, provider} = profile;
    const user: GoogleUserResDto = {
      id,
      email: emails[0].value,
      displayName: displayName,
      picture: photos[0].value,
      provider,
    };
    return user;
  }
}
