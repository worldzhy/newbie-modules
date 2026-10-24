import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, stripHtml } from "./rss.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

const FEED_URL = "https://www.bleepingcomputer.com/feed/";
const DEFAULT_USER_AGENT = "threat-intelligence-collector (+https://github.com/worldzhy)";

/**
 * BleepingComputer adapter (RSS) — English security news.
 *
 * BleepingComputer is a major English-language security news outlet. Items
 * are news articles; externalId is the article URL. Severity is inferred
 * from title keywords because news items carry no severity rating.
 */
export class BleepingComputerAdapter implements ThreatIntelligenceSourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.BLEEPING_COMPUTER;

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
    return {
      source: this.source,
      category: THREAT_INTELLIGENCE_CATEGORY.EN_NEWS,
      externalId: item.link || item.guid,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity: this.parseSeverity(item.title),
      signalTags: [],
      rawPayload: item,
    };
  }

  private parseSeverity(
    title: string,
  ): (typeof THREAT_INTELLIGENCE_SEVERITY)[keyof typeof THREAT_INTELLIGENCE_SEVERITY] {
    const lower = title.toLowerCase();
    if (lower.includes("critical") || lower.includes("cve") || lower.includes("zero-day"))
      return THREAT_INTELLIGENCE_SEVERITY.HIGH;
    if (lower.includes("vulnerability") || lower.includes("exploit") || lower.includes("ransomware"))
      return THREAT_INTELLIGENCE_SEVERITY.MEDIUM;
    return THREAT_INTELLIGENCE_SEVERITY.INFO;
  }
}
