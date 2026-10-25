import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { inferNewsSeverity, parseRssItems, RssItem, stripHtml } from "./rss.util";
import { THREAT_INTELLIGENCE_CATEGORY, THREAT_INTELLIGENCE_SOURCE } from "../threat-intelligence.constants";

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

  private mapItem(item: RssItem): SourceIntelItem {
    return {
      source: this.source,
      category: THREAT_INTELLIGENCE_CATEGORY.EN_NEWS,
      externalId: item.link || item.guid,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity: inferNewsSeverity(item.title),
      signalTags: [],
      rawPayload: item,
    };
  }
}
