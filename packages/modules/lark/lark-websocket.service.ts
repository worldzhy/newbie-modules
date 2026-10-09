import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Lark from "@larksuiteoapi/node-sdk";
import { LarkService } from "./lark.service";

/**
 * Lark WebSocket long-connection client. Receives im.message.receive_v1
 * events and card.action.trigger callbacks via the SDK and dispatches them
 * through LarkService.dispatchMessage / dispatchCardAction — the same paths
 * webhook events take — so message parsing, bot-mention detection, card
 * handling, and deduplication stay in one place.
 *
 * The previous implementation constructed a mock webhook body and called
 * handleWebhook, which duplicated the message-parsing logic and lost the
 * SDK's typed payload. This rewrite delegates to dispatchMessage directly.
 */
@Injectable()
export class LarkWebSocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LarkWebSocketService.name);
  private client: Lark.WSClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly larkService: LarkService,
  ) {}

  async onModuleInit() {
    const appId = this.configService.get<string>("modules.lark.appId");
    const appSecret = this.configService.get<string>("modules.lark.appSecret");

    if (!appId || !appSecret) {
      this.logger.warn("Lark App ID or Secret is missing, skipping WebSocket client initialization.");
      return;
    }

    this.logger.log("Initializing Lark WebSocket Client...");

    try {
      this.client = new Lark.WSClient({
        appId,
        appSecret,
        loggerLevel: Lark.LoggerLevel.info,
      });

      await this.client.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data) => {
            const message = data.message;
            if (!message) return;

            const chatType = message.chat_type || "";
            const msgType = message.message_type || "";
            const mentions = message.mentions || [];

            if (msgType !== "text" && msgType !== "post") {
              this.logger.debug(`[WebSocket] Ignored non-text message (type: ${msgType}): ${message.message_id}`);
              return;
            }

            const senderOpenId = data.sender?.sender_id?.open_id || "unknown";

            this.logger.log(`[WebSocket] Received message: ${message.message_id} from chat: ${message.chat_id}`);

            try {
              await this.larkService.dispatchMessage({
                chatId: message.chat_id,
                chatType,
                msgType,
                content: message.content,
                mentions,
                senderOpenId,
                parentMessageId: message.parent_id,
                messageId: message.message_id,
              });
            } catch (error) {
              this.logger.error(`[WebSocket] Error dispatching message ${message.message_id}`, error);
            }
          },
          "card.action.trigger": async (data) => {
            this.logger.log(
              `[WebSocket] Card action: ${JSON.stringify({
                messageId: data.open_message_id || data.context?.open_message_id || data.message_id,
                operator: data.operator?.open_id,
                value: data.action?.value,
              })}`,
            );
            // Returning the result lets the WebSocket SDK deliver the toast in the
            // response frame (long-connection equivalent of the webhook HTTP
            // response body).
            return await this.larkService.dispatchCardAction({
              action: data.action,
              operatorOpenId: data.operator?.open_id,
              messageId: data.open_message_id || data.context?.open_message_id || data.message_id,
            });
          },
        }),
      });

      this.logger.log("Lark WebSocket Client started successfully.");
    } catch (error) {
      this.logger.error("Failed to start Lark WebSocket Client", error);
    }
  }

  async onModuleDestroy() {
    this.logger.log("Lark WebSocket Client stopped.");
  }
}
