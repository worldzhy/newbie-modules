import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Lark from "@larksuiteoapi/node-sdk";
import { LarkService } from "./lark.service";

/**
 * Lark WebSocket long-connection client. Receives im.message.receive_v1
 * events via the SDK and dispatches them directly through
 * LarkService.dispatchMessage — the same path webhook events take — so
 * message parsing, bot-mention detection, and deduplication stay in one
 * place.
 *
 * The previous implementation constructed a mock webhook body and called
 * handleWebhook, which duplicated the message-parsing logic and lost the
 * SDK's typed payload. This rewrite delegates to dispatchMessage directly.
 */
@Injectable()
export class LarkWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LarkWsService.name);
  private client: Lark.WSClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly larkService: LarkService,
  ) {}

  async onModuleInit() {
    const appId =
      this.configService.get<string>("modules.lark.appId");
    const appSecret =
      this.configService.get<string>("modules.lark.appSecret");

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
              this.logger.debug(`[WS] Ignored non-text message (type: ${msgType}): ${message.message_id}`);
              return;
            }

            const senderOpenId = data.sender?.sender_id?.open_id || "unknown";

            this.logger.log(
              `[WS] Received message: ${message.message_id} from chat: ${message.chat_id}`,
            );

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
              this.logger.error(`[WS] Error dispatching message ${message.message_id}`, error);
            }
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
