import { Global, Module } from "@nestjs/common";
import { AwsCredentialsController } from "./aws-credentials.controller";
import { AwsCredentialsService } from "./aws-credentials.service";

@Global()
@Module({
  controllers: [AwsCredentialsController],
  providers: [AwsCredentialsService],
  exports: [AwsCredentialsService],
})
export class AwsIdentityModule {}
