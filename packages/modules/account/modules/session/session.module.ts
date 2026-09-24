import {Global, Module} from '@nestjs/common';
import {SessionService} from './session.service';
import {SessionController} from './session.controller';

@Global()
@Module({
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
