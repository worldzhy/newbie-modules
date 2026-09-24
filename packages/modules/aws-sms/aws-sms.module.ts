import {Global, Module} from '@nestjs/common';
import {AwsSmsService} from './aws-sms.service';

@Global()
@Module({
  providers: [AwsSmsService],
  exports: [AwsSmsService],
})
export class AwsSmsModule {}
