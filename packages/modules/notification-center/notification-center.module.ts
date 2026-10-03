import { Global, Module } from "@nestjs/common";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationRegistryService } from "./notification-registry.service";
import { NotificationSettingService } from "./notification-setting.service";
import { MessagePushService } from "./services/message-push.service";

@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [MessagePushService, NotificationCenterService, NotificationRegistryService, NotificationSettingService],
  exports: [NotificationCenterService, NotificationRegistryService, NotificationSettingService, MessagePushService],
})
export class NotificationCenterModule {}
