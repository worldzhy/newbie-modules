import { SourceKnowledgeItem, SecurityEvaluationKnowledgeSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, RssItem, stripHtml } from "./rss.util";
import {
  SECURITY_EVALUATION_KNOWLEDGE_CATEGORY,
  SECURITY_EVALUATION_KNOWLEDGE_SEVERITY,
  SECURITY_EVALUATION_KNOWLEDGE_SOURCE,
} from "../security-evaluation-knowledge.constants";

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
export class AwsSecurityBulletinsAdapter implements SecurityEvaluationKnowledgeSourceAdapter {
  readonly source = SECURITY_EVALUATION_KNOWLEDGE_SOURCE.AWS_SECURITY_BULLETINS;

  async fetchLatest(_since?: Date): Promise<SourceKnowledgeItem[]> {
    const xml = await fetchText(this.source, FEED_URL, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      timeoutMs: 20000,
    });
    return parseRssItems(xml).map((item) => this.mapItem(item));
  }

  private mapItem(item: RssItem): SourceKnowledgeItem {
    const externalId = this.extractBulletinId(item.link) || item.guid;
    const severity = this.parseSeverity(item.title, item.description);
    return {
      source: this.source,
      category: SECURITY_EVALUATION_KNOWLEDGE_CATEGORY.PLATFORM_EVENT,
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
  ): (typeof SECURITY_EVALUATION_KNOWLEDGE_SEVERITY)[keyof typeof SECURITY_EVALUATION_KNOWLEDGE_SEVERITY] {
    // Word-boundary matching: substring "low" also matches "below"/"follow",
    // which previously misclassified bulletins with no severity keyword.
    const text = `${title} ${stripHtml(description)}`;
    if (/\bcritical\b/i.test(text)) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.CRITICAL;
    if (/\bhigh\b/i.test(text) || /\bimportant\b/i.test(text)) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.HIGH;
    if (/\bmedium\b/i.test(text) || /\bmoderate\b/i.test(text)) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.MEDIUM;
    if (/\blow\b/i.test(text)) return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.LOW;
    return SECURITY_EVALUATION_KNOWLEDGE_SEVERITY.INFO;
  }
}
