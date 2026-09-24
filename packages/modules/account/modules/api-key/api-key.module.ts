import {Global, Module} from '@nestjs/common';
import {ApiKeyService} from './api-key.service';
import {ApiKeyController} from './api-key.controller';
import {OrganizationApiKeyController} from './api-key.organization.controller';

@Global()
@Module({
  controllers: [ApiKeyController, OrganizationApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
