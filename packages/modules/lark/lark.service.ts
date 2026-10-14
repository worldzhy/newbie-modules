import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as Lark from "@larksuiteoapi/node-sdk";
import { GetChatHistoryRequestDto, SendTextDto, SendCardDto, UpdateCardDto } from "./lark.dto";
import { decryptLarkEvent } from "./lark-event.util";
import { parseMessage, resolveSenderOpenId } from "./lark-message-parser";
import type {
  LarkWebhookBody,
  LarkCardAction,
  LarkCardActionMeta,
  LarkCardActionResult,
  LarkMessage,
} from "./lark-types";

type MessageHandler = (
  chatId: string,
  text: string,
  userId?: string,
  parentId?: string,
  messageId?: string,
  // "p2p" for a user's direct chat with the bot, "group" for a group chat.
  chatType?: string,
) => Promise<void>;
type CardActionHandler = (payload: LarkCardAction, meta: LarkCardActionMeta) => Promise<LarkCardActionResult | void>;

type ReceiveIdType = "open_id" | "user_id" | "union_id" | "email" | "chat_id";

/** A tenant contact user, flattened for the binding admin picker. */
export interface LarkDirectoryUser {
  openId: string;
  name: string;
  email: string | null;
}

interface MessageDispatchInput {
  chatId: string;
  chatType: string;
  msgType: string;
  content: string;
  mentions: LarkMessage["mentions"];
  senderOpenId: string;
  parentMessageId?: string;
  messageId: string;
}

/**
 * Lark/Feishu integration service: OpenAPI calls + webhook dispatch.
 *
 * REST calls go through the official SDK client, which owns tenant access
 * token acquisition, caching and refresh. The webhook path and the WebSocket
 * path both funnel through `dispatchMessage` so message parsing and
 * bot-mention detection stay in one place. Webhook event ids are deduplicated
 * to survive Lark's retry redelivery.
 */
@Injectable()
export class LarkService {
  private readonly logger = new Logger(LarkService.name);
  private clientInstance?: Lark.Client;

  private messageHandler?: MessageHandler;
  private cardActionHandler?: CardActionHandler;

  private readonly botOpenId: string | undefined;
  private readonly processedEventIds = new Map<string, number>();
  private readonly EVENT_ID_TTL_MS = 5 * 60_000;

  // The full tenant contact traversal is several paginated calls and changes
  // rarely, so it is cached briefly for admin-page search sessions.
  private directoryCache: { users: LarkDirectoryUser[]; expiresAt: number } | null = null;
  private readonly DIRECTORY_CACHE_TTL_MS = 10 * 60_000;
  private directoryTraversalInFlight: Promise<LarkDirectoryUser[]> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.botOpenId = this.configService.get<string>("modules.lark.botOpenId");
  }

  /**
   * Lazily constructed SDK client so a missing Lark config only fails the
   * first API call, not application bootstrap (same contract as the previous
   * hand-written token acquisition).
   */
  private get client(): Lark.Client {
    if (!this.clientInstance) {
      const appId = this.configService.get<string>("modules.lark.appId");
      const appSecret = this.configService.get<string>("modules.lark.appSecret");
      if (!appId || !appSecret) {
        throw new Error("Lark App ID or Secret is not configured");
      }
      this.clientInstance = new Lark.Client({
        appId,
        appSecret,
        loggerLevel: Lark.LoggerLevel.warn,
      });
    }
    return this.clientInstance;
  }

  /**
   * Register the single message handler. Last writer wins; registering twice
   * silently replaces the previous handler. This matches the existing contract
   * but is now explicit. If multi-handler support is needed, switch to an array.
   */
  onMessageReceived(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Register the single card-action handler. The handler receives both the
   * button payload and envelope metadata (real clicker openId, message id).
   * Identity must only be taken from `meta`, never from the button value.
   * Return a result to control the webhook response (e.g. a toast); returning
   * void yields a plain success envelope.
   */
  onCardActionReceived(handler: CardActionHandler): void {
    this.cardActionHandler = handler;
  }

  async getChatHistory(dto: GetChatHistoryRequestDto) {
    try {
      const res = await this.client.im.message.list({
        params: {
          container_id_type: "chat",
          container_id: dto.chatId,
          ...(dto.startTime ? { start_time: dto.startTime } : {}),
          ...(dto.endTime ? { end_time: dto.endTime } : {}),
          ...(dto.pageToken ? { page_token: dto.pageToken } : {}),
          ...(dto.pageSize ? { page_size: dto.pageSize } : {}),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Failed to get chat history: ${res.msg}`);
      }
      return res.data;
    } catch (error) {
      this.logger.error("Error fetching chat history", error);
      throw error;
    }
  }

  /**
   * Main webhook entry point. Dispatches to specialized handlers based on
   * payload shape. Deduplicates by event_id so Lark redeliveries are no-ops.
   */
  async handleWebhook(body: LarkWebhookBody): Promise<unknown> {
    // 1. URL verification challenge (no event_id, never dedup).
    if (body.type === "url_verification" || body.header?.event_type === "url_verification") {
      this.logger.log("Received URL verification challenge");
      return { challenge: body.challenge };
    }

    // 2. Encrypted event — decrypt and re-dispatch (the decrypted body has no
    //    `encrypt` field, so this cannot loop).
    if (body.encrypt) {
      const encryptKey = this.configService.get<string>("modules.lark.encryptKey");
      if (!encryptKey) {
        this.logger.error("Received an encrypted Lark event but LARK_ENCRYPT_KEY is not configured; event dropped.");
        return { code: 0, msg: "success" };
      }

      let decrypted: unknown;
      try {
        decrypted = decryptLarkEvent(encryptKey, body.encrypt);
      } catch (error) {
        this.logger.error("Failed to decrypt Lark webhook event", error);
        return { code: 0, msg: "success" };
      }
      return this.handleWebhook(decrypted as LarkWebhookBody);
    }

    // 3. Card action (button click on an interactive card). Card actions do
    //    not carry header.event_type; they have `action` at the root.
    //    No dedup here: card callbacks carry only the card's open_message_id
    //    (identical across repeat clicks), so dedup would swallow legitimate
    //    repeat clicks that must reach the handler for the not-found toast.
    if (body.action && body.action.value) {
      this.logger.log("Received card action trigger");
      if (this.cardActionHandler) {
        try {
          const result = await this.cardActionHandler(body.action, {
            openId: body.open_id,
            openMessageId: body.open_message_id,
          });
          if (result) return result;
        } catch (error) {
          this.logger.error("Error processing card action", error);
        }
      }
      return { code: 0, msg: "success" };
    }

    // 4. Message event.
    if (body.header?.event_type === "im.message.receive_v1") {
      const eventId = body.header.event_id;
      if (this.isDuplicateEvent(eventId)) {
        this.logger.debug(`Duplicate message event ignored: ${eventId}`);
        return { code: 0, msg: "success" };
      }

      const message = body.event?.message;
      if (!message) return { code: 0, msg: "success" };

      const chatId = message.chat_id;
      const msgType = message.msg_type || message.message_type || "";
      const chatType = message.chat_type || "";

      this.logger.log(`Received message event: ${message.message_id} from chat: ${chatId}`);

      if (msgType !== "text" && msgType !== "post") {
        this.logger.debug(`Ignored non-text message (type: ${msgType}): ${message.message_id}`);
        return { code: 0, msg: "success" };
      }

      try {
        await this.dispatchMessage({
          chatId,
          chatType,
          msgType,
          content: message.content,
          mentions: message.mentions,
          senderOpenId: resolveSenderOpenId(message, body.event?.sender),
          parentMessageId: message.parent_id,
          messageId: message.message_id,
        });
      } catch (error) {
        this.logger.error("Error processing message from webhook", error);
      }
    }

    return { code: 0, msg: "success" };
  }

  /**
   * Shared message dispatch for webhook and WebSocket paths. Parses the
   * message, checks bot mention in group chats, and invokes the registered
   * message handler.
   */
  async dispatchMessage(input: MessageDispatchInput): Promise<void> {
    const message: LarkMessage = {
      message_id: input.messageId,
      chat_id: input.chatId,
      chat_type: input.chatType,
      msg_type: input.msgType,
      message_type: input.msgType,
      content: input.content,
      parent_id: input.parentMessageId,
      mentions: input.mentions,
    };

    const parsed = parseMessage(message, this.botOpenId);

    if (input.chatType === "group" && !parsed.botMentioned) {
      this.logger.debug(`Ignored group message without bot mention: ${input.messageId}`);
      return;
    }

    if (!parsed.text) {
      this.logger.debug(`Ignored empty message: ${input.messageId}`);
      return;
    }

    this.logger.log(`Message content (cleaned): ${parsed.text}`);

    if (this.messageHandler) {
      await this.messageHandler(
        input.chatId,
        parsed.text,
        input.senderOpenId,
        input.parentMessageId,
        input.messageId,
        input.chatType,
      );
    }
  }

  /**
   * Card action dispatch for the WebSocket long-connection path. The SDK
   * normalizes the payload differently than the webhook envelope, so this
   * adapter bridges the gap and funnels into the same registered handler.
   */
  async dispatchCardAction(input: {
    action: LarkCardAction;
    operatorOpenId?: string;
    messageId?: string;
  }): Promise<LarkCardActionResult | undefined> {
    // The WebSocket client base64-encodes a handler's return value into the
    // response frame, which is how Lark delivers the toast in
    // long-connection mode — so the result must propagate.
    if (this.cardActionHandler) {
      try {
        const result = await this.cardActionHandler(input.action, {
          openId: input.operatorOpenId,
          openMessageId: input.messageId,
        });
        return result ?? undefined;
      } catch (error) {
        this.logger.error("Error processing card action", error);
      }
    }
    return undefined;
  }

  private isDuplicateEvent(eventId?: string): boolean {
    if (!eventId) return false;
    const now = Date.now();
    this.cleanupExpiredEventIds(now);
    if (this.processedEventIds.has(eventId)) {
      this.processedEventIds.set(eventId, now);
      return true;
    }
    this.processedEventIds.set(eventId, now);
    return false;
  }

  private cleanupExpiredEventIds(now: number): void {
    for (const [id, timestamp] of this.processedEventIds) {
      if (now - timestamp > this.EVENT_ID_TTL_MS) {
        this.processedEventIds.delete(id);
      }
    }
  }

  async sendText(dto: SendTextDto) {
    try {
      const res = await this.client.im.message.create({
        params: {
          receive_id_type: (dto.receiveIdType || "chat_id") as ReceiveIdType,
        },
        data: {
          receive_id: dto.receiveId,
          msg_type: "text",
          content: JSON.stringify({ text: dto.text }),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Failed to send text message: ${res.msg}`);
      }
      return res.data;
    } catch (error) {
      this.logger.error("Error sending text message", error);
      throw error;
    }
  }

  async sendCard(dto: SendCardDto) {
    try {
      const res = await this.client.im.message.create({
        params: {
          receive_id_type: (dto.receiveIdType || "chat_id") as ReceiveIdType,
        },
        data: {
          receive_id: dto.receiveId,
          msg_type: "interactive",
          content: JSON.stringify(dto.card),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Failed to send card message: ${res.msg}`);
      }
      return res.data;
    } catch (error) {
      this.logger.error("Error sending card message", error);
      throw error;
    }
  }

  /**
   * Update a previously sent interactive card in place (PATCH
   * /im/v1/messages/:message_id). Only cards sent by this bot can be updated.
   */
  async updateCard(dto: UpdateCardDto) {
    try {
      const res = await this.client.im.message.patch({
        path: { message_id: dto.messageId },
        data: {
          content: JSON.stringify(dto.card),
        },
      });

      if (res.code !== 0) {
        throw new Error(`Failed to update card message: ${res.msg}`);
      }
      return res.data;
    } catch (error) {
      this.logger.error("Error updating card message", error);
      throw error;
    }
  }

  async getMessageContent(messageId: string) {
    try {
      const res = await this.client.im.message.get({
        path: { message_id: messageId },
      });

      if (res.code !== 0) {
        throw new Error(`Failed to get message content: ${res.msg}`);
      }
      return res.data?.items?.[0];
    } catch (error) {
      this.logger.error(`Error fetching message content for ID: ${messageId}`, error);
      throw error;
    }
  }

  async getChatMembers(chatId: string) {
    const members: unknown[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await this.client.im.chatMembers.get({
          path: { chat_id: chatId },
          params: {
            member_id_type: "open_id",
            page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });

        if (res.code !== 0) {
          throw new Error(`Failed to get chat members: ${res.msg}`);
        }

        members.push(...(res.data?.items ?? []));
        hasMore = res.data?.has_more ?? false;
        pageToken = res.data?.page_token;
      }
      return members;
    } catch (error) {
      this.logger.error(`Error fetching members for chat ID: ${chatId}`, error);
      throw error;
    }
  }

  /**
   * List the chats the bot is a member of (im.chat.list), paginating through
   * all pages. Hosts use this to offer pickable chats when managing chat
   * bindings, so a chat id is never hand-typed.
   */
  async listBotChats(): Promise<Array<{ chatId: string; name: string }>> {
    const chats: Array<{ chatId: string; name: string }> = [];
    let pageToken: string | undefined;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await this.client.im.chat.list({
          params: {
            page_size: 100,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });

        if (res.code !== 0) {
          throw new Error(`Failed to list bot chats: ${res.msg}`);
        }

        for (const item of res.data?.items ?? []) {
          if (item.chat_id) {
            chats.push({ chatId: item.chat_id, name: item.name ?? "" });
          }
        }
        hasMore = res.data?.has_more ?? false;
        pageToken = res.data?.page_token;
      }
      return chats;
    } catch (error) {
      this.logger.error("Error listing bot chats", error);
      throw error;
    }
  }

  /**
   * Search tenant contacts by display name or email for the user-binding
   * admin picker. Backed by a short-lived cache of the full contact
   * directory: the dedicated contact search endpoints require extra app
   * scopes, whereas department/user listing run on the base contact scopes.
   * Throws when the app lacks contact permissions; callers surface that as
   * an actionable admin error.
   */
  async searchDirectoryUsers(query: string, limit = 20): Promise<LarkDirectoryUser[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    const users = await this.listDirectoryUsers();
    return users
      .filter(
        (user) =>
          user.name.toLowerCase().includes(normalized) ||
          (user.email !== null && user.email.toLowerCase().includes(normalized)),
      )
      .slice(0, limit);
  }

  /**
   * Whether an app-scoped open_id resolves to a real tenant contact. A
   * permission/configuration failure is surfaced (the admin must grant
   * contact scopes); only a genuine not-found resolves to false.
   */
  async directoryUserExists(openId: string): Promise<boolean> {
    try {
      const res = await this.client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: "open_id" },
      } as never);
      return res.code === 0;
    } catch (error) {
      const larkCode = (error as { response?: { data?: { code?: number } } })?.response?.data?.code;
      if (larkCode === 99991672) {
        throw new Error(
          "Lark contact read permission is not granted for the app " +
            "(contact:contact:readonly_as_app or an equivalent contact scope).",
        );
      }
      this.logger.warn(`Failed to look up Lark user ${openId}: ${(error as Error)?.message}`);
      return false;
    }
  }

  /**
   * All tenant contact users (cached). Concurrent admin searches during one
   * traversal share the same in-flight promise.
   */
  async listDirectoryUsers(): Promise<LarkDirectoryUser[]> {
    const now = Date.now();
    if (this.directoryCache && this.directoryCache.expiresAt > now) {
      return this.directoryCache.users;
    }
    if (this.directoryTraversalInFlight) {
      return this.directoryTraversalInFlight;
    }
    this.directoryTraversalInFlight = this.traverseDirectoryUsers()
      .then((users) => {
        this.directoryCache = { users, expiresAt: Date.now() + this.DIRECTORY_CACHE_TTL_MS };
        return users;
      })
      .finally(() => {
        this.directoryTraversalInFlight = null;
      });
    return this.directoryTraversalInFlight;
  }

  /**
   * Walk the department tree from root ("0") and flatten every department's
   * users. Users appearing under multiple departments are deduplicated by
   * open_id.
   */
  private async traverseDirectoryUsers(): Promise<LarkDirectoryUser[]> {
    // The generated SDK request types drift across minor versions; the
    // contact v3 shapes here are stable, so cross that boundary loosely.
    const contact = this.client.contact as unknown as {
      department: {
        list: (req: {
          path: { department_id: string };
          params: Record<string, unknown>;
        }) => Promise<{
          code: number;
          msg?: string;
          data?: {
            has_more?: boolean;
            page_token?: string;
            items?: Array<{ open_department_id?: string }>;
          };
        }>;
      };
      user: {
        list: (req: {
          path: { department_id: string };
          params: Record<string, unknown>;
        }) => Promise<{
          code: number;
          msg?: string;
          data?: {
            has_more?: boolean;
            page_token?: string;
            items?: Array<{ open_id?: string; name?: string; email?: string; enterprise_email?: string }>;
          };
        }>;
      };
    };

    let departmentIds: Set<string>;
    try {
      departmentIds = await this.listContactDepartmentIds(contact);
    } catch (error) {
      throw new Error(this.describeContactError("list departments", error));
    }

    const byOpenId = new Map<string, LarkDirectoryUser>();
    for (const departmentId of departmentIds) {
      let userPageToken: string | undefined;
      do {
        let res;
        try {
          res = await contact.user.list({
            path: { department_id: departmentId },
            params: {
              department_id_type: "open_department_id",
              user_id_type: "open_id",
              page_size: 50,
              ...(userPageToken ? { page_token: userPageToken } : {}),
            },
          });
        } catch (error) {
          throw new Error(this.describeContactError(`list users for department ${departmentId}`, error));
        }
        if (res.code !== 0) {
          throw new Error(`Failed to list Lark users for department ${departmentId}: ${res.msg}`);
        }
        for (const item of res.data?.items ?? []) {
          if (!item.open_id) continue;
          byOpenId.set(item.open_id, {
            openId: item.open_id,
            name: item.name ?? "",
            email: item.email ?? item.enterprise_email ?? null,
          });
        }
        userPageToken = res.data?.has_more ? res.data?.page_token : undefined;
      } while (userPageToken);
    }
    this.logger.log(`Loaded ${byOpenId.size} Lark contact users across ${departmentIds.size} departments`);
    return [...byOpenId.values()];
  }

  /** All department ids under root ("0"), including the root itself. */
  private async listContactDepartmentIds(
    contact: {
      department: {
        list: (req: {
          path: { department_id: string };
          params: Record<string, unknown>;
        }) => Promise<{
          code: number;
          msg?: string;
          data?: {
            has_more?: boolean;
            page_token?: string;
            items?: Array<{ open_department_id?: string }>;
          };
        }>;
      };
    },
  ): Promise<Set<string>> {
    const departmentIds = new Set<string>(["0"]);
    let pageToken: string | undefined;
    do {
      const res = await contact.department.list({
        path: { department_id: "0" },
        params: {
          department_id_type: "open_department_id",
          fetch_child: true,
          page_size: 50,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      });
      if (res.code !== 0) {
        throw new Error(`Failed to list Lark departments: ${res.msg}`);
      }
      for (const item of res.data?.items ?? []) {
        if (item.open_department_id) departmentIds.add(item.open_department_id);
      }
      pageToken = res.data?.has_more ? res.data?.page_token : undefined;
    } while (pageToken);
    return departmentIds;
  }

  /**
   * Extract the platform message from an SDK contact-API failure: the SDK
   * throws axios-style errors whose Lark code/msg live on response.data.
   */
  private describeContactError(action: string, error: unknown): string {
    const lark = (error as {
      response?: { data?: { code?: number; msg?: string } };
      code?: number;
      msg?: string;
    })?.response?.data;
    const detail = lark?.msg ?? (error as Error)?.message ?? String(error);
    const scopeHint =
      lark?.code === 99991672
        ? " The app needs contact read scopes granted in the Lark developer console."
        : "";
    return `Failed to ${action}: ${detail}.${scopeHint}`;
  }

  async addReaction(messageId: string, emojiType: string = "OK") {
    try {
      const res = await this.client.im.messageReaction.create({
        path: { message_id: messageId },
        data: {
          reaction_type: { emoji_type: emojiType },
        },
      });

      if (res.code !== 0) {
        this.logger.warn(`Failed to add reaction to message ${messageId}: ${res.msg}`);
      }
    } catch (error) {
      this.logger.warn(`Error adding reaction to message ${messageId}: ${(error as Error)?.message}`);
    }
  }
}
