import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {AuthModule} from '../auth/auth.module';

import {TokensModule} from '../../providers/tokens/tokens.module';
import {TwilioModule} from '../../providers/twilio/twilio.module';
import {MultiFactorAuthenticationController} from './multi-factor-authentication.controller';
import {MultiFactorAuthenticationService} from './multi-factor-authentication.service';

@Module({
  imports: [AuthModule, TwilioModule, ConfigModule, TokensModule],
  controllers: [MultiFactorAuthenticationController],
  providers: [MultiFactorAuthenticationService],
})
export class MultiFactorAuthenticationModule {}
