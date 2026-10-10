/**
 * Typed shapes for Lark/Feishu webhook events, card actions, and message
 * payloads. These replace the `any` types that previously flowed through
 * LarkService and LarkWebSocketService, giving downstream consumers (notably the
 * Copilot Lark transport) compile-time safety on webhook/card-action data.
 *
 * Reference: https://open.feishu.cn/document/server-docs/im-v1/message/events
 */

/** A Lark mention object as it appears inside a message event payload. */
export interface LarkMention {
  /** Placeholder key in the message text, e.g. `@_user_1`. */
  key?: string;
  /** The name shown to other users when this mention is rendered. */
  name?: string;
  id?: {
    open_id?: string;
    union_id?: string;
    /** Bot mentions lack a user_id; this is the basis for bot detection. */
    user_id?: string;
  };
}

/** Sender identity block embedded in every webhook/WebSocket message event. */
export interface LarkSender {
  sender_id: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
}

/** The message body of an `im.message.receive_v1` event. */
export interface LarkMessage {
  message_id: string;
  chat_id: string;
  /** "p2p" or "group". */
  chat_type?: string;
  /** "text", "post", "image", etc. */
  msg_type?: string;
  message_type?: string;
  /** Raw JSON string; structure depends on msg_type. */
  content: string;
  parent_id?: string;
  mentions?: LarkMention[];
  /** Fallback for SDK WebSocket payloads where the field is named differently. */
  sender?: LarkSender;
}

/** Full `im.message.receive_v1` webhook event. */
export interface LarkMessageEvent {
  message: LarkMessage;
  sender?: LarkSender;
}

/** Card action webhook payload (button click on an interactive card). */
export interface LarkCardAction {
  /** The value object attached to the clicked button. */
  value?: Record<string, string>;
  /** Other arbitrary fields the card may carry. */
  [key: string]: unknown;
}

/**
 * Callback metadata for a card action. Button `value` is card-author-controlled
 * and must never carry identity; these fields come from the webhook envelope.
 */
export interface LarkCardActionMeta {
  /** Real clicker, from the webhook body root (`body.open_id`). */
  openId?: string;
  /** Card message id (`body.open_message_id`); redelivery dedupe key. */
  openMessageId?: string;
}

/**
 * Optional structured result a card handler returns as the webhook response.
 * A void result makes LarkService answer with a plain success envelope.
 */
export interface LarkCardActionResult {
  toast?: {
    type: "success" | "error" | "info";
    content: string;
  };
  /**
   * Updated card content delivered atomically with the toast as part of the
   * callback response frame. Lark replaces the card immediately — no
   * separate PATCH /im/v1/messages/:message_id call, so the card can never
   * race the Lark platform's internal card refresh (which reverts a PATCH
   * to the original pending state).
   */
  card?: Record<string, unknown>;
}

/** Webhook header present on v2 event callbacks. */
export interface LarkWebhookHeader {
  event_id: string;
  token: string;
  create_time: string;
  event_type: string;
  tenant_key: string;
  app_id: string;
}

/** The full webhook body Lark posts to the callback URL. */
export interface LarkWebhookBody {
  schema?: string;
  header?: LarkWebhookHeader;
  event?: LarkMessageEvent;
  challenge?: string;
  type?: string;
  encrypt?: string;
  /** Present on card-action callbacks (no header.event_type). */
  action?: LarkCardAction;
  open_id?: string;
  user_id?: string;
  tenant_key?: string;
  open_message_id?: string;
}

/** Result of parsing a Lark message into a clean text + mention metadata. */
export interface ParsedMessage {
  /** Cleaned text with @mention placeholders resolved to names. */
  text: string;
  /** Whether the bot itself was mentioned. */
  botMentioned: boolean;
  /** All mentions from the original payload. */
  mentions: LarkMention[];
}
