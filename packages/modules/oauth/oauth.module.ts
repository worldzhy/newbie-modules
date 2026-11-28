import { Global, Module } from "@nestjs/common";
import { OAuthController } from "./oauth.controller";
import { OAuthService } from "./oauth.service";

/**
 * OAuth Authorization Code Flow (ADR-081). Standalone top-level module so a
 * host can opt in via `newbie modules add oauth`. Business state (clients,
 * codes, consents) and the protocol endpoints live here; bearer transport
 * reuses the existing JWT + Session resolution chain. Depends on account's
 * SessionService for token minting and refresh rotation (injected via the
 * global `@Global` AccountModule).
 */
@Global()
@Module({
  controllers: [OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
