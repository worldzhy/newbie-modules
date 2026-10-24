import { SourceAdapter, SourceIntelItem } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, stripHtml } from "./rss.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

const FEED_URL = "https://www.freebuf.com/feed";

/**
 * FreeBuf adapter (RSS) — Chinese security news.
 *
 * FreeBuf is a major Chinese security portal. Items are news articles;
 * externalId is the article URL. Severity defaults to info because news
 * items do not carry a severity rating.
 */
export class FreeBufAdapter implements SourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.FREEBUF;

  async fetchLatest(_since?: Date): Promise<SourceIntelItem[]> {
    const xml = await fetchText(this.source, FEED_URL, { timeoutMs: 20000 });
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
      category: THREAT_INTELLIGENCE_CATEGORY.CN_NEWS,
      externalId: item.link || item.guid,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity: THREAT_INTELLIGENCE_SEVERITY.INFO,
      signalTags: [],
      rawPayload: item,
    };
  }
}
