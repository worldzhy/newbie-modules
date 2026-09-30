import {Global, Module} from '@nestjs/common';
import {ScheduleModule} from '@nestjs/schedule';
import {AwsAuditController} from './aws-audit.controller';
import {AwsAuditService} from './aws-audit.service';

@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AwsAuditController],
  providers: [AwsAuditService],
  exports: [AwsAuditService],
})
export class AwsAuditModule {}
