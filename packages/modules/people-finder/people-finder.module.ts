import {Module, Global} from '@nestjs/common';
import {VoilaNorbertModule} from '@modules/people-finder/voila-norbert/module';
import {ProxycurlModule} from '@modules/people-finder/proxycurl/module';
import {PeopledatalabsModule} from '@modules/people-finder/peopledatalabs/module';
import {PeopleFinderService} from './people-finder.service';
import {PeopleFinderNotificationService} from './people-finder.notification.service';

@Global()
@Module({
  imports: [VoilaNorbertModule, ProxycurlModule, PeopledatalabsModule],
  providers: [PeopleFinderService, PeopleFinderNotificationService],
  exports: [
    PeopleFinderService,
    PeopleFinderNotificationService,
    VoilaNorbertModule,
    ProxycurlModule,
    PeopledatalabsModule,
  ],
})
export class PeopleFinderModule {}
