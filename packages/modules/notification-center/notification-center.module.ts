import { Global, Module } from "@nestjs/common";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { NotificationTypeRegistryService } from "./notification-type-registry.service";
import { NotificationTypeService } from "./notification-type.service";
import { MessagePushService } from "./services/message-push.service";

@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [MessagePushService, NotificationCenterService, NotificationTypeRegistryService, NotificationTypeService],
  exports: [NotificationCenterService, NotificationTypeRegistryService, NotificationTypeService, MessagePushService],
})
export class NotificationCenterModule {}
