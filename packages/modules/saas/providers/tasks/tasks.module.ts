import {Module} from '@nestjs/common';
import {DomainsModule} from '../../modules/domains/domains.module';
import {TasksService} from './tasks.service';
import {UsersModule} from '../../modules/users/users.module';
import {MetricsModule} from '../../modules/metrics/metrics.module';

@Module({
  imports: [DomainsModule, UsersModule, MetricsModule],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
