import { Global, Module } from "@nestjs/common";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationDeliveryRuleService } from "./notification-delivery-rule.service";
import { NotificationRegistryService } from "./notification-registry.service";
import { NotificationSettingService } from "./notification-setting.service";

@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [
    NotificationCenterService,
    NotificationDeliveryRuleService,
    NotificationRegistryService,
    NotificationSettingService,
  ],
  exports: [
    NotificationCenterService,
    NotificationDeliveryRuleService,
    NotificationRegistryService,
    NotificationSettingService,
  ],
})
export class NotificationCenterModule {}
