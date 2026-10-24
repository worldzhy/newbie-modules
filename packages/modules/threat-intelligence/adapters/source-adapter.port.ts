import {
  ThreatIntelligenceCategory,
  ThreatIntelligenceSeverity,
  ThreatIntelligenceSignalTag,
  ThreatIntelligenceSource,
} from "../threat-intelligence.constants";

/**
 * A normalized threat intel item as produced by a source adapter.
 *
 * Adapters are responsible for fetching from their upstream and mapping
 * the upstream payload into this shape. The service deduplicates by
 * (source, externalId).
 */
export interface SourceIntelItem {
  source: ThreatIntelligenceSource;
  category: ThreatIntelligenceCategory;
  /** Stable identifier within the source (CVE ID, ecosystem+package, etc.). */
  externalId: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt?: Date;
  severity: ThreatIntelligenceSeverity;
  signalTags: ThreatIntelligenceSignalTag[];
  /** Raw upstream payload for audit / re-processing. */
  rawPayload: unknown;
}

/**
 * Port implemented by every information source adapter.
 *
 * Each adapter is registered as a provider and tagged with its source
 * identifier. The service collects all adapters via multi-binding and
 * invokes fetchLatest in sequence.
 */
export interface SourceAdapter {
  readonly source: ThreatIntelligenceSource;

  /**
   * Fetch the latest batch of items from this source. Implementations
   * should return only items newer than `since` when the source supports
   * it; otherwise return the full recent window and let the service
   * deduplicate.
   */
  fetchLatest(since?: Date): Promise<SourceIntelItem[]>;
}

export const SOURCE_ADAPTER = Symbol("SourceAdapter");
