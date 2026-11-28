import { Global, Module } from "@nestjs/common";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";

/**
 * OAuth Authorization Code Flow (ADR-081). Business state (clients, codes,
 * consents) and the protocol endpoints live here; bearer transport reuses the
 * existing JWT + Session resolution chain, so this module only depends on the
 * globally-available SessionService for token minting and refresh rotation.
 */
@Global()
@Module({
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
