import { Global, Module } from "@nestjs/common";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationRegistryService } from "./notification-registry.service";
import { NotificationSettingService } from "./notification-setting.service";

@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [NotificationCenterService, NotificationRegistryService, NotificationSettingService],
  exports: [NotificationCenterService, NotificationRegistryService, NotificationSettingService],
})
export class NotificationCenterModule {}
