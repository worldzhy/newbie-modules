import {Global, Module} from '@nestjs/common';
import {PermissionController} from './permission.controller';

@Global()
@Module({
  controllers: [PermissionController],
})
export class PermissionModule {}
