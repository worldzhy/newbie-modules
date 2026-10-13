/**
 * Repository accessibility rule shared by every consumer of an application's
 * `repositoryUrl` (nightly dependency scan, manual scan, copilot data
 * source, provisioning responses, UI gating).
 *
 * Two facts must stay separated:
 *   - repositoryUrl   — naming fact: the target repo URL is deterministic at
 *                       application creation and is persisted immediately.
 *   - provisioningStatus — availability fact: whether the repo actually exists
 *                       and is reachable. Mode A runs PROVISIONING -> READY /
 *                       FAILED; mode B registers an existing repo and has a
 *                       null status ("naturally ready").
 *
 * A persisted URL is therefore NOT enough to act on the repo: it may point at
 * a repo that is still being created, or — on a name-conflict failure — at an
 * external repo that merely occupies the name. Consumers must gate on
 * accessibility, never on `repositoryUrl != null` alone.
 *
 * This helper deliberately takes plain strings and has no Prisma/enum import
 * so it can live in the generic github module and be reused by both host code
 * and newbie modules. The host layer owns the provisioning lifecycle and the
 * Prisma `where` adapter; this file owns the boolean semantics only.
 */

// The provisioning statuses are owned by the host application schema; mirrored
// as literals here so the generic module needs no host enum dependency.
export const REPOSITORY_STATUS_READY = "READY";

export interface RepositoryAccessState {
  repositoryUrl: string | null;
  // Host enum ApplicationProvisioningStatus | null, accepted as a plain string.
  provisioningStatus: string | null;
}

/**
 * The repository exists and may be acted upon iff it has a persisted URL and
 * provisioning has either succeeded (READY) or never applied (mode B, null).
 * PROVISIONING and FAILED are not accessible even though the URL is persisted.
 */
export function isRepositoryAccessible(state: RepositoryAccessState): boolean {
  if (!state.repositoryUrl) return false;
  return state.provisioningStatus === null || state.provisioningStatus === REPOSITORY_STATUS_READY;
}
