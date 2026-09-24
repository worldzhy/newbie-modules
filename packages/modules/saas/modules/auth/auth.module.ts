import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {PassportModule} from '@nestjs/passport';
import {GeolocationModule} from '../../providers/geolocation/geolocation.module';

import {PwnedModule} from '../../providers/pwned/pwned.module';
import {TokensModule} from '../../providers/tokens/tokens.module';
import {TwilioModule} from '../../providers/twilio/twilio.module';
import {ApiKeysModule} from '../api-keys/api-keys.module';
import {ApprovedSubnetsModule} from '../approved-subnets/approved-subnets.module';
import {ApprovedSubnetsService} from '../approved-subnets/approved-subnets.service';
import {AuthController} from './auth.controller';
import {AuthService} from './auth.service';
import {SaaSStarterStrategy} from './strategies/auth.strategy';
import {GoogleStrategy} from './strategies/google.strategy';

@Module({
  imports: [
    PassportModule.register({defaultStrategy: 'jwt'}),
    TokensModule,
    ConfigModule,
    PwnedModule,
    ApiKeysModule,
    TwilioModule,
    GeolocationModule,
    ApprovedSubnetsModule,
  ],
  controllers: [AuthController],
  exports: [AuthService],
  providers: [
    AuthService,
    SaaSStarterStrategy,
    GoogleStrategy,
    ApprovedSubnetsService,
  ],
})
export class AuthModule {}
