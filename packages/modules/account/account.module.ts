import {Global, Module} from '@nestjs/common';

import {AccountController} from './account.controller';
import {AccountService} from './account.service';
import {GeolocationService} from './helpers/geolocation.service';
import {AuthModule} from './auth/auth.module';
import {SecurityModule} from './security/security.module';

import {ApiKeyModule} from './modules/api-key/api-key.module';
import {ApprovedSubnetModule} from './modules/approved-subnet/approved-subnet.module';
import {AuditLogModule} from './modules/audit-logs/audit-log.module';
import {PermissionModule} from './modules/permission/permission.module';
import {SessionModule} from './modules/session/session.module';
import {UserModule} from './modules/user/user.module';
import {VerificationCodeModule} from './modules/verification-code/verification-code.module';

@Global()
@Module({
  imports: [
    AuthModule,
    SecurityModule,

    ApiKeyModule,
    ApprovedSubnetModule,
    AuditLogModule,
    PermissionModule,
    SessionModule,
    UserModule,
    VerificationCodeModule,
  ],
  controllers: [AccountController],
  providers: [AccountService, GeolocationService],
  exports: [AccountService, GeolocationService, SecurityModule],
})
export class AccountModule {}
