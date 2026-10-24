import { SourceIntelItem, ThreatIntelligenceSourceAdapter } from "./source-adapter.port";
import { fetchJson } from "./http.util";
import {
  THREAT_INTELLIGENCE_CATEGORY,
  THREAT_INTELLIGENCE_SEVERITY,
  THREAT_INTELLIGENCE_SIGNAL_TAG,
  THREAT_INTELLIGENCE_SOURCE,
} from "../threat-intelligence.constants";

interface CisaKevVulnerability {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: string;
  notes: string;
}

interface CisaKevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: CisaKevVulnerability[];
}

const CATALOG_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

/**
 * CISA Known Exploited Vulnerabilities (KEV) adapter.
 *
 * The catalog is the authoritative list of vulnerabilities that are known
 * to be actively exploited in the wild. Every item carries the `kev` and
 * `exploited-in-wild` signal tags so downstream matching can prioritize
 * them regardless of CVSS severity.
 *
 * The full catalog is fetched each run (currently ~1000 entries, ~500KB)
 * and the service deduplicates by CVE id.
 */
export class CisaKevAdapter implements ThreatIntelligenceSourceAdapter {
  readonly source = THREAT_INTELLIGENCE_SOURCE.CISA_KEV;

  async fetchLatest(_since?: Date): Promise<SourceIntelItem[]> {
    // The catalog does not support date-range filtering; we always fetch
    // the full list and rely on service-level deduplication.
    const catalog = await fetchJson<CisaKevCatalog>(this.source, CATALOG_URL, {
      timeoutMs: 30000,
    });
    return catalog.vulnerabilities.map((vuln) => this.mapItem(vuln));
  }

  private mapItem(vuln: CisaKevVulnerability): SourceIntelItem {
    return {
      source: this.source,
      category: THREAT_INTELLIGENCE_CATEGORY.CVE,
      externalId: vuln.cveID,
      title: vuln.vulnerabilityName.slice(0, 500),
      summary: this.buildSummary(vuln),
      url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog`,
      publishedAt: new Date(vuln.dateAdded),
      severity: THREAT_INTELLIGENCE_SEVERITY.HIGH,
      signalTags: [THREAT_INTELLIGENCE_SIGNAL_TAG.KEV, THREAT_INTELLIGENCE_SIGNAL_TAG.EXPLOITED_IN_WILD],
      rawPayload: vuln,
    };
  }

  private buildSummary(vuln: CisaKevVulnerability): string {
    const lines: string[] = [];
    lines.push(`Vendor/Project: ${vuln.vendorProject}`);
    lines.push(`Product: ${vuln.product}`);
    if (vuln.shortDescription) lines.push(vuln.shortDescription);
    if (vuln.requiredAction) lines.push(`Required action: ${vuln.requiredAction}`);
    if (vuln.knownRansomwareCampaignUse && vuln.knownRansomwareCampaignUse !== "Unknown") {
      lines.push(`Known ransomware campaign use: ${vuln.knownRansomwareCampaignUse}`);
    }
    return lines.join("\n");
  }
}
