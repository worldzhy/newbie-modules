import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * RepositoryAccess — the host-provided read-only access to a repository asset.
 *
 * The module never talks to a code host directly: credentials and installation
 * scoping stay in the host, and a non-repository deployment simply does not
 * bind the token (assembly error, like the skeleton's own SPI ports).
 *
 * The subject itself carries the coordinate: `subject.subjectKey` is the natural
 * key `provider:namespace/name` (ADR-070 D2), so the implementation needs no
 * lookup table of its own — it parses the key and dispatches on the provider.
 */
export const securityEvaluationRepositoryAccessToken = "SECURITY_EVALUATION_REPOSITORY_ACCESS";

export interface RepositoryAccess {
  /** File content at a repository-root path, or null when the file does not exist. */
  getFile(subject: EvaluationSubjectRef, path: string): Promise<string | null>;
}
