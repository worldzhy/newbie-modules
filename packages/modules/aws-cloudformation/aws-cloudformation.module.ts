import { Global, Module } from "@nestjs/common";
import { AwsCloudformationStackController } from "./stack/stack.controller";
import { AwsCloudformationStackService } from "./stack/stack.service";
import { AwsEnvironmentController } from "./environment/environment.controller";
import { AwsCloudformationService } from "./aws-cloudformation.service";

@Global()
@Module({
  controllers: [AwsEnvironmentController, AwsCloudformationStackController],
  providers: [AwsCloudformationStackService, AwsCloudformationService],
  exports: [AwsCloudformationStackService, AwsCloudformationService],
})
export class AwsCloudformationModule {}
