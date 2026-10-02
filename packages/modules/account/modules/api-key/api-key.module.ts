import { Global, Module } from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyController } from "./api-key.controller";

// OrganizationApiKeyController is intentionally not registered: without an
// organization membership check, those endpoints let any authenticated user
// manage keys of arbitrary organization ids. Re-register (and add membership
// authorization) once an organization/membership module is assembled.
// import {OrganizationApiKeyController} from './api-key.organization.controller';

@Global()
@Module({
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
