import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * SPI port for subject-scoped entity resolution (ADR-018, re-homed under
 * security-evaluation by ADR-039, re-shaped by ADR-058).
 *
 * The INTEL judgment needs the set of entities the run's subject cares about
 * (package names, repository slugs, vendors, domains). Deriving those from
 * business data is the one host-specific step of matching, so hosts bind an
 * implementation of this port and the module stays agnostic of host concepts
 * like Project or Application.
 */
export const SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER = Symbol("SECURITY_EVALUATION_SCOPE_ENTITIES_PROVIDER");

/**
 * A single entity that an intel item is checked against.
 * Examples: "next", "worldzhy/nightwatch-backend", "github.com".
 */
export interface SecurityEvaluationScopeEntity {
  /** Entity label, e.g. package name, vendor, repository slug, or domain. */
  value: string;
  /**
   * Optional human-readable detail about this entity (which application or
   * project contributed it, say). No host populates it today. It is serialized
   * into the re-rank payload and therefore into `inputSignature`, so starting
   * to fill it in invalidates every cached verdict — wire it behind an ADR
   * rather than as a drive-by change.
   */
  context?: string;
}

export interface SecurityEvaluationScopeEntitiesProvider {
  /**
   * The entity set of one evaluation subject.
   *
   * Return `null` when the host does not know the subject: a run over an
   * unknown subject would report a vacuous clean result, so the module fails
   * closed. Return an empty list when the subject is known but has no
   * matchable entity.
   */
  listScopeEntities(subject: EvaluationSubjectRef): Promise<SecurityEvaluationScopeEntity[] | null>;
}
