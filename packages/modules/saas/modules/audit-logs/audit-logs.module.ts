import {Module} from '@nestjs/common';

import {AuditLogController} from './audit-logs.controller';
import {AuditLogTeamController} from './audit-logs-team.controller';
import {AuditLogUserController} from './audit-logs-user.controller';
import {AuditLogsService} from './audit-logs.service';

@Module({
  controllers: [
    AuditLogController,
    AuditLogTeamController,
    AuditLogUserController,
  ],
  providers: [AuditLogsService],
})
export class AuditLogsModule {}
