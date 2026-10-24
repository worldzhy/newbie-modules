import { SourceAdapter, SourceIntelItem } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, stripHtml } from "./rss.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

const FEED_URL = "https://aws.amazon.com/security/security-bulletins/feed/";
const DEFAULT_USER_AGENT = "threat-intelligence-collector (+https://github.com/worldzhy)";

/**
 * AWS Security Bulletins adapter (RSS).
 *
 * AWS publishes a single RSS feed of all security bulletins. The bulletin
 * id (e.g. "2026-137-aws") is extracted from the item link URL and used as
 * the externalId. Severity is derived from the title or the "Content Type"
 * field in the description.
 */
export class AwsSecurityBulletinsAdapter implements SourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.AWS_SECURITY_BULLETINS;

  async fetchLatest(_since?: Date): Promise<SourceIntelItem[]> {
    const xml = await fetchText(this.source, FEED_URL, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      timeoutMs: 20000,
    });
    return parseRssItems(xml).map((item) => this.mapItem(item));
  }

  private mapItem(item: {
    title: string;
    link: string;
    guid: string;
    description: string;
    pubDate: string;
  }): SourceIntelItem {
    const externalId = this.extractBulletinId(item.link) || item.guid;
    const severity = this.parseSeverity(item.title, item.description);
    return {
      source: this.source,
      category: THREAT_INTELLIGENCE_CATEGORY.PLATFORM_EVENT,
      externalId,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity,
      signalTags: [],
      rawPayload: item,
    };
  }

  /** Extract the bulletin id like "2026-137-aws" from the link URL. */
  private extractBulletinId(link: string): string {
    const match = link.match(/\/rss\/(\d{4}-\d{3}-aws)\/?/i);
    return match ? match[1].toUpperCase() : "";
  }

  private parseSeverity(
    title: string,
    description: string,
  ): (typeof THREAT_INTELLIGENCE_SEVERITY)[keyof typeof THREAT_INTELLIGENCE_SEVERITY] {
    const text = `${title} ${stripHtml(description)}`.toLowerCase();
    if (text.includes("critical")) return THREAT_INTELLIGENCE_SEVERITY.CRITICAL;
    if (text.includes("high") || text.includes("important")) return THREAT_INTELLIGENCE_SEVERITY.HIGH;
    if (text.includes("medium") || text.includes("moderate")) return THREAT_INTELLIGENCE_SEVERITY.MEDIUM;
    if (text.includes("low")) return THREAT_INTELLIGENCE_SEVERITY.LOW;
    return THREAT_INTELLIGENCE_SEVERITY.INFO;
  }
}
