import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchText } from "./http.util";
import { inferNewsSeverity, parseRssItems, RssItem, stripHtml } from "./rss.util";
import { THREAT_INTELLIGENCE_CATEGORY, THREAT_INTELLIGENCE_SOURCE } from "../threat-intelligence.constants";

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

  private mapItem(item: RssItem): SourceIntelItem {
    const severity = inferNewsSeverity(item.title, {
      high: ["critical", "cve"],
      medium: ["vulnerability", "security advisory"],
    });
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
}
