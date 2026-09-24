import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {AuthModule} from '../auth/auth.module';

import {TokensModule} from '../../providers/tokens/tokens.module';
import {UserController} from './users.controller';
import {UsersService} from './users.service';
import {ApiKeysModule} from '../api-keys/api-keys.module';

@Module({
  imports: [AuthModule, ConfigModule, TokensModule, ApiKeysModule],
  controllers: [UserController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
