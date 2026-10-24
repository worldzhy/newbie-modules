/**
 * Minimal RSS 2.0 parser shared by RSS-based source adapters.
 *
 * We avoid adding an XML parser dependency because the feeds we consume
 * (AWS bulletins, GitHub security blog, FreeBuf) all follow stable RSS 2.0
 * structure and regex extraction is sufficient.
 */

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
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return itemBlocks.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    guid: extractTag(block, "guid"),
    description: extractTag(block, "description"),
    pubDate: extractTag(block, "pubDate"),
  }));
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

/** Strip HTML tags and decode common entities for plain-text summaries. */
export function stripHtml(html: string): string {
  return html
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
