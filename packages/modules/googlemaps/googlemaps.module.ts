import {Global, Module} from '@nestjs/common';
import {GooglePlacesService} from './google-places.service';

@Global()
@Module({
  providers: [GooglePlacesService],
  exports: [GooglePlacesService],
})
export class GoogleMapsModule {}
