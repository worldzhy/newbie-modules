import {Global, Module} from '@nestjs/common';
import {AwsSesController} from './aws-ses.controller';
import {AwsSesService} from './aws-ses.service';
import {AwsSesSuppressionListController} from './suppression-list/suppression-list.controller';
import {AwsSesSuppressionListService} from './suppression-list/suppression-list.service';

@Global()
@Module({
  controllers: [AwsSesController, AwsSesSuppressionListController],
  providers: [AwsSesService, AwsSesSuppressionListService],
  exports: [AwsSesService, AwsSesSuppressionListService],
})
export class AwsSesModule {}
