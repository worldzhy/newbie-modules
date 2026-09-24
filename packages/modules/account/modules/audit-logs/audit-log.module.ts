import {Global, Module} from '@nestjs/common';
import {AuditLogController} from './audit-log.controller';

@Global()
@Module({
  controllers: [AuditLogController],
})
export class AuditLogModule {}
