import type { EvaluationSubjectRef } from "@modules/evaluation/ports/evaluation.contracts";

/**
 * RepositorySnapshotAccess — host-provided read-only access to a whole
 * repository snapshot (ADR-054). The single-file RepositoryAccess port cannot
 * support a full-tree scan: CODE_SCAN needs the file list and must read every
 * file of one run at the same pinned revision, otherwise the manifest mixes
 * files from different commits and the evidence is not self-consistent.
 *
 * The contract is vendor-neutral: `revision` is an opaque host string (a
 * commit sha, a Bitbucket node id, …) and paths are repository-root relative.
 * The module never talks to a code host directly; an unbound token fails the
 * run with a wiring error, like the skeleton's own SPI ports.
 */
export const securityEvaluationRepositorySnapshotAccessToken = "SECURITY_EVALUATION_REPOSITORY_SNAPSHOT_ACCESS";

/** What the run wants scanned. The host enforces the budgets and accounts the cut-offs in `skipped`. */
export interface RepositorySnapshotSelection {
  /** Repository-root relative glob-like prefixes/patterns; undefined means "all text sources". */
  include?: readonly string[];
  exclude?: readonly string[];
  maxFiles: number;
  maxFileBytes: number;
}

export interface RepositorySnapshotEntry {
  path: string;
  sizeBytes: number;
}

/** One file the host listed but did not include in `entries`, with the reason (binary, over budget, unreadable). */
export interface RepositorySnapshotSkippedEntry {
  path: string;
  reason: string;
  /**
   * When set, this entry aggregates `count` files (e.g. over the file budget
   * or hidden by a truncated tree). Only one such entry is emitted per reason,
   * and `path` becomes an empty string placeholder.
   */
  count?: number;
}

export interface RepositorySnapshotListing {
  /** The pinned revision every entry and every subsequent read of this run resolves at. */
  revision: string;
  entries: RepositorySnapshotEntry[];
  skipped: RepositorySnapshotSkippedEntry[];
}

export interface RepositorySnapshotAccess {
  /**
   * List the scannable files of the subject at a pinned revision. The revision
   * is chosen by the host at call time (typically the default-branch head) and
   * pins the whole run.
   */
  list(subject: EvaluationSubjectRef, selection: RepositorySnapshotSelection): Promise<RepositorySnapshotListing>;
  /**
   * Read file contents at the given revision. The revision MUST be the one a
   * previous `list` returned — reading at anything newer would break manifest
   * self-consistency. A path absent from the returned map is a read failure
   * and is accounted in the run's skipped bucket by the collector.
   */
  read(subject: EvaluationSubjectRef, revision: string, paths: readonly string[]): Promise<Map<string, string>>;
}
