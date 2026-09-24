import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {ApprovedSubnetsService} from '../approved-subnets/approved-subnets.service';
import {AuthService} from '../auth/auth.service';
import {GeolocationService} from '../../providers/geolocation/geolocation.service';

import {PwnedModule} from '../../providers/pwned/pwned.module';
import {TokensModule} from '../../providers/tokens/tokens.module';
import {TwilioModule} from '../../providers/twilio/twilio.module';
import {UsersService} from '../users/users.service';
import {EmailController} from './emails.controller';
import {EmailsService} from './emails.service';
import {ApiKeysModule} from '../api-keys/api-keys.module';

@Module({
  imports: [
    ConfigModule,
    TwilioModule,
    PwnedModule,
    TokensModule,
    ApiKeysModule,
  ],
  controllers: [EmailController],
  providers: [
    EmailsService,
    UsersService,
    AuthService,
    GeolocationService,
    ApprovedSubnetsService,
  ],
})
export class EmailsModule {}
