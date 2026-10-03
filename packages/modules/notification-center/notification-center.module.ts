import { Global, Module } from "@nestjs/common";
import { NotificationCenterController } from "./notification-center.controller";
import { NotificationCenterService } from "./notification-center.service";
import { SecurityAlertService } from "./security-alert.service";
import { MessagePushService } from "./services/message-push.service";

@Global()
@Module({
  controllers: [NotificationCenterController],
  providers: [MessagePushService, NotificationCenterService, SecurityAlertService],
  exports: [NotificationCenterService, MessagePushService],
})
export class NotificationCenterModule {}
