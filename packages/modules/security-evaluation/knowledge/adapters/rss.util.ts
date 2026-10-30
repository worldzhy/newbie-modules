/**
 * Minimal RSS 2.0 parser shared by RSS-based source adapters.
 *
 * We avoid adding an XML parser dependency because the feeds we consume
 * (AWS bulletins, GitHub security blog, FreeBuf) all follow stable RSS 2.0
 * structure and regex extraction is sufficient.
 */

import {
  SECURITY_EVALUATION_KNOWLEDGE_SEVERITY,
  SecurityEvaluationKnowledgeSeverity,
} from "../security-evaluation-knowledge.constants";

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  description: string;
  pubDate: string;
}

/**
 * Parse an RSS 2.0 feed into a list of items.
 */
export function parseRssItems(xml: string): RssItem[] {
  const itemBlocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/g) ?? [];
  return itemBlocks.map((block: string) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    guid: extractTag(block, "guid"),
    description: extractTag(block, "description"),
    pubDate: extractTag(block, "pubDate"),
  }));
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? unwrapCdata(match[1].trim()) : "";
}

/**
 * WordPress-style feeds wrap title/description/guid in CDATA; unwrap it so
 * downstream consumers never see the `<![CDATA[` markers.
 */
function unwrapCdata(value: string): string {
  const match = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return match ? match[1].trim() : value;
}

/** Strip HTML tags and decode common entities for plain-text summaries. */
export function stripHtml(html: string): string {
  return unwrapCdata(html.trim())
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infer a severity for news items, which carry no upstream severity rating,
 * from title keywords. Defaults cover the common English security-news
 * vocabulary; adapters pass `overrides` to tune either tier.
 */
export function inferNewsSeverity(
  title: string,
  overrides?: { high?: string[]; medium?: string[] },
): SecurityEvaluationKnowledgeSeverity {
  const high = overrides?.high ?? ["critical", "cve", "zero-day"];
  const medium = overrides?.medium ?? ["vulnerability", "exploit", "ransomware"];
  const lower = title.toLowerCase();
  if (high.some((keyword) => lower.includes(keyword))) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.HIGH;
  if (medium.some((keyword) => lower.includes(keyword))) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.MEDIUM;
  return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.INFO;
}
