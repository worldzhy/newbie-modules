import {Global, Module} from '@nestjs/common';
import {ApprovedSubnetController} from './approved-subnet.controller';
import {ApprovedSubnetService} from './approved-subnet.service';

@Global()
@Module({
  controllers: [ApprovedSubnetController],
  providers: [ApprovedSubnetService],
  exports: [ApprovedSubnetService],
})
export class ApprovedSubnetModule {}
