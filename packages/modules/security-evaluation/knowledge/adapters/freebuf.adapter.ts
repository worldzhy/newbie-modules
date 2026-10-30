import { SourceKnowledgeItem, SecurityEvaluationKnowledgeSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, RssItem, stripHtml } from "./rss.util";
import {
  SECURITY_EVALUATION_KNOWLEDGE_CATEGORY,
  SECURITY_EVALUATION_KNOWLEDGE_SEVERITY,
  SECURITY_EVALUATION_KNOWLEDGE_SOURCE,
} from "../security-evaluation-knowledge.constants";

const FEED_URL = "https://www.freebuf.com/feed";

/**
 * FreeBuf adapter (RSS) — Chinese security news.
 *
 * FreeBuf is a major Chinese security portal. Items are news articles;
 * externalId is the article URL. Severity defaults to info because news
 * items do not carry a severity rating.
 */
export class FreeBufAdapter implements SecurityEvaluationKnowledgeSourceAdapter {
  readonly source = SECURITY_EVALUATION_KNOWLEDGE_SOURCE.FREEBUF;

  async fetchLatest(_since?: Date): Promise<SourceKnowledgeItem[]> {
    const xml = await fetchText(this.source, FEED_URL, { timeoutMs: 20000 });
    return parseRssItems(xml).map((item) => this.mapItem(item));
  }

  private mapItem(item: RssItem): SourceKnowledgeItem {
    return {
      source: this.source,
      category: SECURITY_EVALUATION_KNOWLEDGE_CATEGORY.CN_NEWS,
      externalId: item.link || item.guid,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity: SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.INFO,
      signalTags: [],
      rawPayload: item,
    };
  }
}
