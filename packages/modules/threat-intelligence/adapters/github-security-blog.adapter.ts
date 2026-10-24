import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { parseRssItems, stripHtml } from "./rss.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

const FEED_URL = "https://github.blog/category/security/feed/";

/**
 * GitHub Security Blog adapter (RSS).
 *
 * GitHub publishes security-related blog posts under the /category/security
 * feed. These are platform-level security events and advisories (e.g.
 * GitHub Actions vulnerabilities, supply-chain incidents). externalId is
 * the post URL.
 */
export class GitHubSecurityBlogAdapter implements ThreatIntelligenceSourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.GITHUB_SECURITY_BLOG;

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
    const severity = this.parseSeverity(item.title);
    return {
      source: this.source,
      category: THREAT_INTELLIGENCE_CATEGORY.PLATFORM_EVENT,
      externalId: item.link || item.guid,
      title: item.title.slice(0, 500),
      summary: item.description ? stripHtml(item.description).slice(0, 1000) : undefined,
      url: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
      severity,
      signalTags: [],
      rawPayload: item,
    };
  }

  private parseSeverity(
    title: string,
  ): (typeof THREAT_INTELLIGENCE_SEVERITY)[keyof typeof THREAT_INTELLIGENCE_SEVERITY] {
    const lower = title.toLowerCase();
    if (lower.includes("critical") || lower.includes("cve")) return THREAT_INTELLIGENCE_SEVERITY.HIGH;
    if (lower.includes("vulnerability") || lower.includes("security advisory"))
      return THREAT_INTELLIGENCE_SEVERITY.MEDIUM;
    return THREAT_INTELLIGENCE_SEVERITY.INFO;
  }
}
