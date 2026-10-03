import { Global, Module } from "@nestjs/common";
import { SecurityModule } from "@modules/security/security.module";
import { ACCESS_TOKEN_SESSION_RESOLVER } from "@modules/security/ports/access-token-session.resolver";
import { API_KEY_VERIFIER } from "@modules/security/ports/api-key.verifier";
import { PERMISSION_AUTHORIZER } from "@modules/security/ports/permission.authorizer";
import { LOGIN_ACCOUNT_RESOLVER } from "@modules/security/ports/login-account.resolver";

import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
import { GeolocationService } from "./helpers/geolocation.service";
import { AuthModule } from "./auth/auth.module";

import { ApiKeyModule } from "./modules/api-key/api-key.module";
import { ApprovedSubnetModule } from "./modules/approved-subnet/approved-subnet.module";
import { AuditLogModule } from "./modules/audit-logs/audit-log.module";
import { PermissionModule } from "./modules/permission/permission.module";
import { SessionModule } from "./modules/session/session.module";
import { TwoFactorModule } from "./modules/two-factor/two-factor.module";
import { UserModule } from "./modules/user/user.module";
import { VerificationCodeModule } from "./modules/verification-code/verification-code.module";

import { AccountAccessTokenSessionResolver } from "./security-ports/access-token-session.resolver";
import { AccountApiKeyVerifier } from "./security-ports/api-key.verifier";
import { AccountPermissionAuthorizer } from "./security-ports/permission.authorizer";
import { AccountLoginAccountResolver } from "./security-ports/login-account.resolver";

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
    TwoFactorModule,
    UserModule,
    VerificationCodeModule,
  ],
  controllers: [AccountController],
  providers: [
    AccountService,
    GeolocationService,
    // Bind account's data layer to security's SPI ports.
    { provide: ACCESS_TOKEN_SESSION_RESOLVER, useClass: AccountAccessTokenSessionResolver },
    { provide: API_KEY_VERIFIER, useClass: AccountApiKeyVerifier },
    { provide: PERMISSION_AUTHORIZER, useClass: AccountPermissionAuthorizer },
    { provide: LOGIN_ACCOUNT_RESOLVER, useClass: AccountLoginAccountResolver },
  ],
  exports: [AccountService, GeolocationService],
})
export class AccountModule {}
