import { Module, Global } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { LarkChannelController } from "./lark/lark-channel.controller";
import { LarkMessageController } from "./lark/lark-message.controller";
import { LarkMessageBotService } from "./lark/lark.service";
import { SlackChannelController } from "./slack/slack-channel.controller";
import { SlackMessageController } from "./slack/slack-message.controller";
import { SlackMessageBotService } from "./slack/slack.service";
import { MessageBotChannelGroupController } from "./message-bot-group.controller";

@Global()
@Module({
  imports: [HttpModule],
  controllers: [
    LarkChannelController,
    LarkMessageController,
    SlackChannelController,
    SlackMessageController,
    MessageBotChannelGroupController,
  ],
  providers: [LarkMessageBotService, SlackMessageBotService],
  exports: [LarkMessageBotService, SlackMessageBotService],
})
export class MessageBotModule {}
