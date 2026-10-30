import {
  SecurityEvaluationKnowledgeCategory,
  SecurityEvaluationKnowledgeSeverity,
  SecurityEvaluationKnowledgeSignalTag,
  SecurityEvaluationKnowledgeSource,
} from "../security-evaluation-knowledge.constants";

/**
 * A normalized knowledge item as produced by a source adapter.
 *
 * Adapters are responsible for fetching from their upstream and mapping
 * the upstream payload into this shape. The service deduplicates by
 * (source, externalId).
 */
export interface SourceKnowledgeItem {
  source: SecurityEvaluationKnowledgeSource;
  category: SecurityEvaluationKnowledgeCategory;
  /** Stable identifier within the source (CVE ID, ecosystem+package, etc.). */
  externalId: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt?: Date;
  severity: SecurityEvaluationKnowledgeSeverity;
  signalTags: SecurityEvaluationKnowledgeSignalTag[];
  /** Raw upstream payload for audit / re-processing. */
  rawPayload: unknown;
}

/**
 * Port implemented by every information source adapter.
 *
 * Each adapter is registered as a provider and tagged with its source
 * identifier. The module gathers all adapters into an array via a factory
 * provider and the service invokes fetchLatest on each in sequence.
 */
export interface SecurityEvaluationKnowledgeSourceAdapter {
  readonly source: SecurityEvaluationKnowledgeSource;

  /**
   * Fetch the latest batch of items from this source. Implementations
   * should return only items newer than `since` when the source supports
   * it; otherwise return the full recent window and let the service
   * deduplicate.
   */
  fetchLatest(since?: Date): Promise<SourceKnowledgeItem[]>;
}

/**
 * Injection token for the gathered array of all registered source adapters.
 * Multi-binding via repeated token providers does not work with @Optional()
 * injection, so the module builds the array in a single factory provider.
 */
export const SECURITY_EVALUATION_KNOWLEDGE_SOURCE_ADAPTERS = Symbol("SecurityEvaluationKnowledgeSourceAdapters");
