import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';

import {TokensModule} from '../../providers/tokens/tokens.module';
import {ApiKeysModule} from '../api-keys/api-keys.module';
import {AuthModule} from '../auth/auth.module';
import {TeamsModule} from '../teams/teams.module';
import {TeamMembershipController} from './memberships-team.controller';
import {UserMembershipController} from './memberships-user.controller';
import {MembershipsService} from './memberships.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TeamsModule,
    ApiKeysModule,
    TokensModule,
  ],
  controllers: [UserMembershipController, TeamMembershipController],
  providers: [MembershipsService],
})
export class MembershipsModule {}
