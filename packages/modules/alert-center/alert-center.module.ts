import { Global, Module } from "@nestjs/common";
import { AlertCenterController } from "./alert-center.controller";
import { AlertCenterService } from "./alert-center.service";
import { AlertSourceRegistryService } from "./alert-source-registry.service";

@Global()
@Module({
  controllers: [AlertCenterController],
  providers: [AlertCenterService, AlertSourceRegistryService],
  exports: [AlertCenterService, AlertSourceRegistryService],
})
export class AlertCenterModule {}
