import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchJson } from "./http.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

interface GitHubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  url: string;
  html_url: string;
  summary: string;
  description: string;
  severity: string | null;
  published_at: string | null;
  updated_at: string | null;
  vulnerabilities?: Array<{
    package?: { ecosystem?: string; name?: string };
    severity?: string;
  }>;
}

const API_URL = "https://api.github.com/advisories";

/**
 * GitHub Security Advisory adapter.
 *
 * Covers both CVE-class (component vulnerabilities) and malicious-package
 * advisories across ecosystems (npm, PyPI, Maven, Go, Rust, etc.). GitHub
 * publishes a unified advisory feed that we normalize into SourceIntelItem.
 *
 * The public endpoint is rate-limited (60 req/hour unauthenticated); the
 * daily job fetches at most 100 items per run which fits comfortably.
 */
export class GitHubSecurityAdvisoryAdapter implements ThreatIntelligenceSourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.GITHUB_SECURITY_ADVISORY;

  private readonly perPage = 100;

  async fetchLatest(since?: Date): Promise<SourceIntelItem[]> {
    const params = new URLSearchParams({
      per_page: String(this.perPage),
      sort: "published",
      direction: "desc",
    });
    if (since) {
      // GitHub filters advisories with `published` (exact date or a
      // `>=YYYY-MM-DDTHH:MM:SSZ` range); `published_at` is silently ignored.
      params.set("published", `>=${since.toISOString().replace(/\.\d+Z$/, "Z")}`);
    }
    const advisories = await fetchJson<GitHubAdvisory[]>(this.source, `${API_URL}?${params.toString()}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "threat-intelligence-collector" },
    });
    return advisories
      .map((advisory) => this.mapItem(advisory))
      .filter((item): item is SourceIntelItem => item !== null);
  }

  private mapItem(advisory: GitHubAdvisory): SourceIntelItem | null {
    const ghsaId = advisory.ghsa_id;
    if (!ghsaId) return null;
    const title = advisory.summary?.trim() || `Security advisory ${ghsaId}`;
    // The dedup key must always be the GHSA id: one CVE often maps to
    // multiple GHSAs, and keying on the CVE id would make them overwrite
    // each other on upsert. The CVE id stays available in summary/rawPayload.
    const externalId = ghsaId;
    // Everything maps to CVE: advisories with a package ecosystem are either
    // component CVEs or malicious-package reports, and we cannot reliably
    // tell the two apart without parsing description text.
    const category = THREAT_INTELLIGENCE_CATEGORY.CVE;
    return {
      source: this.source,
      category,
      externalId,
      title: title.slice(0, 500),
      summary: this.buildSummary(advisory),
      url: advisory.html_url || advisory.url,
      publishedAt: advisory.published_at ? new Date(advisory.published_at) : undefined,
      severity: this.mapSeverity(advisory.severity),
      signalTags: [],
      rawPayload: advisory,
    };
  }

  private buildSummary(advisory: GitHubAdvisory): string | undefined {
    const parts: string[] = [];
    if (advisory.description) parts.push(advisory.description.slice(0, 1000));
    const ecosystems = [...new Set((advisory.vulnerabilities ?? []).map((v) => v.package?.ecosystem).filter(Boolean))];
    if (ecosystems.length > 0) parts.push(`Affected ecosystems: ${ecosystems.join(", ")}`);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  private mapSeverity(
    severity: string | null | undefined,
  ): (typeof THREAT_INTELLIGENCE_SEVERITY)[keyof typeof THREAT_INTELLIGENCE_SEVERITY] {
    switch ((severity ?? "").toLowerCase()) {
      case "critical":
        return THREAT_INTELLIGENCE_SEVERITY.CRITICAL;
      case "high":
        return THREAT_INTELLIGENCE_SEVERITY.HIGH;
      case "moderate":
      case "medium":
        return THREAT_INTELLIGENCE_SEVERITY.MEDIUM;
      case "low":
        return THREAT_INTELLIGENCE_SEVERITY.LOW;
      default:
        return THREAT_INTELLIGENCE_SEVERITY.INFO;
    }
  }
}
