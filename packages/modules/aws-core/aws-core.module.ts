import {Global, Module} from '@nestjs/common';
import {AwsCredentialController} from './aws-credential.controller';
import {AwsCredentialService} from './aws-credential.service';

@Global()
@Module({
  controllers: [AwsCredentialController],
  providers: [AwsCredentialService],
  exports: [AwsCredentialService],
})
export class AwsCoreModule {}
