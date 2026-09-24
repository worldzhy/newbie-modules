import {Global, Module} from '@nestjs/common';
import {MessageTrackerController} from './message-tracker.controller';
import {MessageTrackerService} from './message-tracker.service';
import {MessageTrackerSqsService} from './message-tracker-sqs.service';

@Global()
@Module({
  controllers: [MessageTrackerController],
  providers: [MessageTrackerService, MessageTrackerSqsService],
  exports: [MessageTrackerService],
})
export class MessageTrackerModule {}
