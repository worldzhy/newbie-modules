import {Global, Module} from '@nestjs/common';
import {DepScanController} from './dep-scan.controller';
import {DepScanService} from './dep-scan.service';

@Global()
@Module({
  controllers: [DepScanController],
  providers: [DepScanService],
  exports: [DepScanService],
})
export class DepScanModule {}
