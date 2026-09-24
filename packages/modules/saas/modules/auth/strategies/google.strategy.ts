import {BadRequestException, Injectable} from '@nestjs/common';
import {PassportStrategy} from '@nestjs/passport';
import {
  Strategy,
  Profile,
  VerifyCallback,
  StrategyOptionWithRequest,
} from 'passport-google-oauth20';
import {AuthService} from '../auth.service';
import {ConfigService} from '@nestjs/config';
import {User} from '@prisma/client';

/**
 * local dev, to change file node_modules/oauth/lib/oauth2.js
 *var HPA = require('https-proxy-agent');
  let httpsProxyAgent = null
  // fill in your proxy agent ip and port
  httpsProxyAgent = new HPA.HttpsProxyAgent("http://127.0.0.1:54960");
  // line codes to add
  options.agent = httpsProxyAgent;
  this._executeRequest( http_library, options, post_body, callback );
 */

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService
  ) {
    super(<StrategyOptionWithRequest>{
      clientID: configService.get('microservices.saas.googleAuth.clientId'),
      clientSecret: configService.get(
        'microservices.saas.googleAuth.clientSecret'
      ),
      callbackURL: `${configService.get('microservices.saas.serverHost')}/auth/google/callback`,
      // passReqToCallback: true,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    // req: any,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback
  ): Promise<User> {
    if (!profile) {
      throw new BadRequestException();
    }
    const googleId = profile.id;
    const email = profile.emails[0] ? profile.emails[0].value : '';
    const firstName = profile.name.givenName;
    const lastName = profile.name.familyName;
    const avatar = profile.photos[0] ? profile.photos[0].value : '';
    const user: User = await this.authService.findOrCreateAccountByGoogleAuth({
      googleId,
      email,
      firstName,
      lastName,
      avatar,
    });
    if (!user) {
      throw new BadRequestException();
    }
    return user;
  }
}
