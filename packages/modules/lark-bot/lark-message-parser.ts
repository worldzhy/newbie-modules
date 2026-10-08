import type { LarkMention, LarkMessage, LarkSender, ParsedMessage } from "./lark-types";

/**
 * Unified Lark message parsing. Both the webhook path (LarkBotService) and the
 * WebSocket path (LarkWsService) previously duplicated this logic with subtle
 * divergences; this module is the single source of truth for extracting clean
 * text and detecting whether the bot was mentioned.
 */

/**
 * Determines whether a mention object is the bot itself.
 *
 * When a LARK_BOT_OPEN_ID is configured, the match is exact. Otherwise we fall
 * back to the historical heuristic (no user_id on the mention id means the app
 * was mentioned) and log a warning so the misconfiguration is discoverable.
 */
export function isBotMention(mention: LarkMention, botOpenId?: string): boolean {
  if (botOpenId) {
    return mention.id?.open_id === botOpenId;
  }
  // @all targets everyone including the bot; treat as a bot mention so group
  // broadcasts still reach the handler.
  if (mention.id?.open_id === "all" || mention.key === "@_all") {
    return true;
  }
  return !mention.id?.user_id;
}

/**
 * Extracts plain text from a Lark message content string.
 *
 * - text messages: `{"text": "hello"}` → "hello"
 * - post messages: rich-text 2D array of content blocks; text/at/a elements
 *   are concatenated, blocks separated by newlines.
 *
 * Returns an empty string for unsupported msg_types or parse failures.
 */
export function extractMessageText(content: string, msgType: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "";
  }

  if (msgType === "text") {
    const text = (parsed as { text?: string }).text;
    return typeof text === "string" ? text : "";
  }

  if (msgType === "post") {
    const root = parsed as { content?: unknown; [lang: string]: unknown };
    let blocks: unknown = root.content;
    if (!Array.isArray(blocks)) {
      // Language-keyed shape: { zh_cn: [[...]], en_us: [[...]] }
      const langKey = root.zh_cn ? "zh_cn" : Object.keys(root).find((k) => Array.isArray(root[k]));
      blocks = langKey ? root[langKey] : [];
    }
    if (!Array.isArray(blocks)) return "";

    let extracted = "";
    for (const block of blocks) {
      if (!Array.isArray(block)) continue;
      for (const element of block) {
        const el = element as { tag?: string; text?: string; user_name?: string };
        if (el.tag === "text") {
          extracted += el.text ?? "";
        } else if (el.tag === "at") {
          extracted += el.user_name ? `@${el.user_name}` : "@user";
        } else if (el.tag === "a") {
          extracted += el.text ?? "";
        }
      }
      extracted += "\n";
    }
    return extracted;
  }

  return "";
}

/**
 * Resolve @mention placeholders in the text and detect bot mentions.
 *
 * Bot mentions are removed from the text (the handler does not need them).
 * User mentions are replaced with `@<name>` so the model sees readable names.
 */
export function cleanMentions(
  text: string,
  mentions: LarkMention[] | undefined,
  botOpenId?: string,
): { text: string; botMentioned: boolean } {
  if (!mentions || mentions.length === 0) {
    return { text, botMentioned: false };
  }

  let botMentioned = false;
  let cleaned = text;

  for (const mention of mentions) {
    if (!mention.key) continue;
    if (isBotMention(mention, botOpenId)) {
      botMentioned = true;
      cleaned = cleaned.split(mention.key).join("");
    } else if (mention.name) {
      cleaned = cleaned.split(mention.key).join(`@${mention.name}`);
    }
  }

  return { text: cleaned.replace(/\s+/g, " ").trim(), botMentioned };
}

/**
 * Full parse: extract text from the message content, resolve mentions, and
 * report whether the bot was mentioned. This is the shared entry point for
 * webhook and WebSocket message handling.
 *
 * Sender identity is not part of the parsed message; callers extract it
 * directly from the webhook event or SDK payload.
 */
export function parseMessage(message: LarkMessage, botOpenId?: string): ParsedMessage {
  const msgType = message.message_type || message.msg_type || "";
  const rawText = extractMessageText(message.content, msgType);
  const mentions = message.mentions ?? [];
  const { text, botMentioned } = cleanMentions(rawText, mentions, botOpenId);

  return { text, botMentioned, mentions };
}

/** Extract the sender open_id from a webhook event or SDK payload. */
export function resolveSenderOpenId(
  message: LarkMessage,
  sender?: LarkSender,
): string {
  return sender?.sender_id?.open_id || message.sender?.sender_id?.open_id || "unknown";
}
