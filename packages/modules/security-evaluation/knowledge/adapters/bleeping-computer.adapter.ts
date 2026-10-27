import { SourceKnowledgeItem, SecurityEvaluationKnowledgeSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { inferNewsSeverity, parseRssItems, RssItem, stripHtml } from "./rss.util";
import {
  SECURITY_EVALUATION_KNOWLEDGE_CATEGORY,
  SECURITY_EVALUATION_KNOWLEDGE_SOURCE,
} from "../security-evaluation-knowledge.constants";

const FEED_URL = "https://www.bleepingcomputer.com/feed/";
const DEFAULT_USER_AGENT = "threat-intelligence-collector (+https://github.com/worldzhy)";

/**
 * BleepingComputer adapter (RSS) — English security news.
 *
 * BleepingComputer is a major English-language security news outlet. Items
 * are news articles; externalId is the article URL. Severity is inferred
 * from title keywords because news items carry no severity rating.
 */
export class BleepingComputerAdapter implements SecurityEvaluationKnowledgeSourceAdapter {
  readonly source = SECURITY_EVALUATION_KNOWLEDGE_SOURCE.BLEEPING_COMPUTER;

  async fetchLatest(_since?: Date): Promise<SourceKnowledgeItem[]> {
    const xml = await fetchText(this.source, FEED_URL, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      timeoutMs: 20000,
    });
    return parseRssItems(xml).map((item) => this.mapItem(item));
  }

  private mapItem(item: RssItem): SourceKnowledgeItem {
    return {
      source: this.source,
      category: SECURITY_EVALUATION_KNOWLEDGE_CATEGORY.EN_NEWS,
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
