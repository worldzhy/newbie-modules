import { Global, Module } from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyController } from "./api-key.controller";

// API keys are strictly user-owned: the organization dimension was dropped
// (R6-12) because no host models memberships here, and organization-scoped
// endpoints without a membership check let any authenticated user manage keys
// of arbitrary organization ids.

@Global()
@Module({
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
