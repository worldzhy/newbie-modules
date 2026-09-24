import {Global, Module} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {JwtModule} from '@nestjs/jwt';
import {AwsCloudformationStackController} from './stack/stack.controller';
import {AwsCloudformationStackService} from './stack/stack.service';
import {AwsEnvironmentController} from './environment/environment.controller';
import {AwsEnvironmentService} from './environment/environment.service';
import {AwsSecretKeyTokenService} from './token/secretkey-token.service';
import {AwsCloudformationService} from './cloudformation.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('microservices.cloudformation.token.secret'),
      }),
    }),
  ],
  controllers: [AwsEnvironmentController, AwsCloudformationStackController],
  providers: [AwsCloudformationStackService, AwsEnvironmentService, AwsSecretKeyTokenService, AwsCloudformationService],
  exports: [AwsCloudformationStackService, AwsEnvironmentService, AwsCloudformationService],
})
export class AwsCloudformationModule {}
