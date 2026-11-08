import { Global, Module } from "@nestjs/common";
import { AwsCrossAccountBindingsController } from "./aws-cross-account-bindings.controller";
import { AwsCrossAccountBindingsService } from "./aws-cross-account-bindings.service";

@Global()
@Module({
  controllers: [AwsCrossAccountBindingsController],
  providers: [AwsCrossAccountBindingsService],
  exports: [AwsCrossAccountBindingsService],
})
export class AwsIdentityModule {}
