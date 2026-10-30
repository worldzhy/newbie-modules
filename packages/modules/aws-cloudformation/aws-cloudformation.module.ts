import { Global, Module } from "@nestjs/common";
import { AwsCloudformationStackController } from "./stack/stack.controller";
import { AwsCloudformationStackService } from "./stack/stack.service";
import { AwsEnvironmentController } from "./environment/environment.controller";
import { AwsEnvironmentService } from "./environment/environment.service";
import { AwsSecretKeyTokenService } from "./token/secretkey-token.service";
import { AwsCloudformationService } from "./aws-cloudformation.service";

@Global()
@Module({
  controllers: [AwsEnvironmentController, AwsCloudformationStackController],
  providers: [AwsCloudformationStackService, AwsEnvironmentService, AwsSecretKeyTokenService, AwsCloudformationService],
  exports: [AwsCloudformationStackService, AwsEnvironmentService, AwsCloudformationService],
})
export class AwsCloudformationModule {}
