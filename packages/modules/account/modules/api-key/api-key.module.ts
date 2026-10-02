import { Global, Module } from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyController } from "./api-key.controller";

// Organization-scoped api-key endpoints were removed: without an organization
// membership check they let any authenticated user manage keys of arbitrary
// organization ids. Re-add (and add membership authorization) once an
// organization/membership module is assembled.

@Global()
@Module({
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
