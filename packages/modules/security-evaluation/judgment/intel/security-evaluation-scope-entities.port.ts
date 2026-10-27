/**
 * SPI port for scope entity resolution (ADR-018, re-homed under
 * security-evaluation by ADR-039).
 *
 * The INTEL judgment needs the set of entities each matchable scope cares
 * about (package names, repository slugs, vendors, domains). Deriving those
 * from business data is the one host-specific step of matching, so hosts
 * bind an implementation of this port and the module stays agnostic of host
 * concepts like Project or Application.
 */
export const SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER = Symbol("SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER");

/**
 * A single entity that an intel item is checked against.
 * Examples: "next", "worldzhy/nightwatch-backend", "github.com".
 */
export interface SecurityEvaluationScopeEntity {
  /** Entity label, e.g. package name, vendor, repository slug, or domain. */
  value: string;
  /** Optional human-readable context shown in the LLM prompt. */
  context?: string;
}

/** The entity set of one matchable scope (e.g. a project in the host). */
export interface SecurityEvaluationScopeEntities {
  /** Host-defined scope discriminator, e.g. "project". Stored verbatim. */
  scopeType: string;
  /** Host-defined scope identifier. Stored without a foreign key. */
  scopeId: string;
  entities: SecurityEvaluationScopeEntity[];
}

export interface SecurityEvaluationScopeEntitiesProvider {
  /**
   * List every matchable scope with its entity set. An empty list disables
   * matching for the run.
   */
  listScopeEntities(): Promise<SecurityEvaluationScopeEntities[]>;
}
