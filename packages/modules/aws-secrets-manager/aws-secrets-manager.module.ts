import { Global, Module } from "@nestjs/common";
import { AwsSecretsManagerController } from "./aws-secrets-manager.controller";
import { AwsSecretsManagerService } from "./aws-secrets-manager.service";
import { AwsIdentityModule } from "@modules/aws-identity/aws-identity.module";

@Global()
@Module({
  imports: [AwsIdentityModule],
  controllers: [AwsSecretsManagerController],
  providers: [AwsSecretsManagerService],
  exports: [AwsSecretsManagerService],
})
export class AwsSecretsManagerModule {}
