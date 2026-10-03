import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@devbie/newbie/prisma/prisma.service";
import { LarkMessageBotService } from "@modules/message-bot/lark/lark.service";
import { SlackMessageBotService } from "@modules/message-bot/slack/slack.service";

export interface MessagePushResult {
  succeeded: number;
  failed: number;
}

// Thin adapter over the message-bot module. Both bot services are optional:
// the in-app notification center works fully without message-bot installed,
// and push is only attempted once a channel group is configured.
@Injectable()
export class MessagePushService {
  private readonly logger = new Logger(MessagePushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly larkMessageBotService?: LarkMessageBotService,
    @Optional() private readonly slackMessageBotService?: SlackMessageBotService,
  ) {}

  // Number of sendable channels currently in the group; zero means a push
  // setting would silently deliver nothing.
  async countChannels(channelGroupId: string): Promise<number> {
    return this.prisma.messageBotChannel.count({ where: { groupId: channelGroupId } });
  }

  async dispatchToGroup(channelGroupId: string, text: string): Promise<MessagePushResult> {
    const channels = await this.prisma.messageBotChannel.findMany({ where: { groupId: channelGroupId } });
    return this.dispatchToChannels(channels, text);
  }

  // Push to an explicit list of channel ids (per-type direct selection).
  async dispatchToChannelIds(channelIds: string[], text: string): Promise<MessagePushResult> {
    if (channelIds.length === 0) {
      return { succeeded: 0, failed: 0 };
    }
    const channels = await this.prisma.messageBotChannel.findMany({ where: { id: { in: channelIds } } });
    return this.dispatchToChannels(channels, text);
  }

  private async dispatchToChannels(
    channels: Array<{ id: string; provider: string }>,
    text: string,
  ): Promise<MessagePushResult> {
    const result: MessagePushResult = { succeeded: 0, failed: 0 };
    for (const channel of channels) {
      // Provider values are stored as "Lark"/"Slack" (MessageBotProvider enum);
      // compare case-insensitively to tolerate legacy lowercase rows.
      const provider = channel.provider.toLowerCase();
      try {
        if (provider === "lark") {
          if (!this.larkMessageBotService) {
            throw new Error("Lark message bot service is unavailable");
          }
          const response = await this.larkMessageBotService.sendText({ channelId: channel.id, text });
          if (response.error) {
            throw new Error(
              typeof response.error === "object" ? JSON.stringify(response.error) : String(response.error),
            );
          }
        } else if (provider === "slack") {
          if (!this.slackMessageBotService) {
            throw new Error("Slack message bot service is unavailable");
          }
          const response = await this.slackMessageBotService.sendText({ channelId: channel.id, text });
          if (response.error) {
            throw new Error(
              typeof response.error === "object" ? JSON.stringify(response.error) : String(response.error),
            );
          }
        } else {
          this.logger.warn(`Skip unsupported message provider "${channel.provider}" on channel ${channel.id}`);
          continue;
        }
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          `Failed to push notification to ${channel.provider} channel ${channel.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return result;
  }
}
