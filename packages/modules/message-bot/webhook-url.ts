import { BadRequestException } from "@nestjs/common";
import { MessageBotProvider } from "./message-bot.constants";

/**
 * A channel webhook is an outbound URL supplied by whoever manages channels,
 * so it is a server-side request forgery sink: an arbitrary host lets the bot
 * reach internal services from the platform's network position. Only the
 * provider-owned webhook endpoints are accepted.
 *
 * The prefix is anchored at the scheme, so host and port are both fixed and a
 * crafted path cannot redirect the request elsewhere.
 */
const ALLOWED_WEBHOOK_PREFIXES: Record<MessageBotProvider, readonly string[]> = {
  [MessageBotProvider.Lark]: ["https://open.feishu.cn/open-apis/bot/", "https://open.larksuite.com/open-apis/bot/"],
  [MessageBotProvider.Slack]: ["https://hooks.slack.com/services/"],
};

/** Outbound webhook calls must not hang a request handler indefinitely. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

export function assertAllowedWebhook(webhook: string, provider: MessageBotProvider): void {
  const allowed = ALLOWED_WEBHOOK_PREFIXES[provider];
  if (!allowed.some((prefix) => webhook.startsWith(prefix))) {
    throw new BadRequestException(`The ${provider} webhook must start with one of: ${allowed.join(", ")}.`);
  }
}
