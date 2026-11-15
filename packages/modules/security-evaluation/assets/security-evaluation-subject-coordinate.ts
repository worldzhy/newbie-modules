import { BadRequestException } from "@nestjs/common";

/**
 * Natural-key coordinates of the material subjects this feature evaluates
 * (ADR-070 D2).
 *
 * Identity is the coordinate itself, never a host primary key: a repository is
 * `provider:namespace/name`, an AWS account is its 12-digit account id. The
 * normalization is the single implementation of that contract — the host builds
 * keys through it and the module re-derives them on ingest, so the two can never
 * disagree.
 */

/** provider of a code host: lowercase, 1…32 chars. */
const REPOSITORY_PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** One coordinate segment: no colon (provider separator), no slash (its own separator), no whitespace. */
const REPOSITORY_SEGMENT_PATTERN = /^[^:/\\\s]+$/;

const REPOSITORY_SEGMENT_MAX_LENGTH = 255;

/** AWS account ids are exactly 12 digits. */
const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;

/** A code-host coordinate: `provider:namespace/name`. */
export interface RepositoryCoordinate {
  provider: string;
  /** GitHub owner / Bitbucket workspace — vendor-neutral name for the first segment. */
  namespace: string;
  name: string;
}

export interface AwsAccountCoordinate {
  accountId: string;
}

/**
 * Normalize a repository coordinate. Provider, namespace and name are
 * lowercased; the caller keeps the original casing as the display name.
 */
export function normalizeRepositoryCoordinate(coordinate: RepositoryCoordinate): RepositoryCoordinate {
  const provider = coordinate.provider?.trim().toLowerCase() ?? "";
  if (!REPOSITORY_PROVIDER_PATTERN.test(provider)) {
    throw new BadRequestException(
      `Repository provider "${coordinate.provider}" must be lowercase alphanumeric with dashes (max 32 chars).`,
    );
  }
  return {
    provider,
    namespace: normalizeSegment(coordinate.namespace, "namespace"),
    name: normalizeSegment(coordinate.name, "name"),
  };
}

/** `${provider}:${namespace}/${name}` — the subject key of a repository subject. */
export function repositorySubjectKey(coordinate: RepositoryCoordinate): string {
  return `${coordinate.provider}:${coordinate.namespace}/${coordinate.name}`;
}

/**
 * Split `<namespace>/<name>` out of a host full name (GitHub `owner/repo`,
 * Bitbucket `workspace/repo`). Throws on anything that is not exactly two
 * non-empty segments.
 */
export function splitRepositoryFullName(fullName: string): { namespace: string; name: string } {
  const segments = (fullName ?? "").trim().split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new BadRequestException(`Repository full name "${fullName}" must be "<namespace>/<name>".`);
  }
  return { namespace: segments[0], name: segments[1] };
}

/**
 * Parse a repository subject key back into its coordinate. Returns `null` when
 * the key is not a repository coordinate (the caller decides whether that is an
 * error).
 */
export function parseRepositorySubjectKey(subjectKey: string): RepositoryCoordinate | null {
  const separator = subjectKey?.indexOf(":") ?? -1;
  if (separator <= 0) return null;
  const provider = subjectKey.slice(0, separator);
  const coordinate = subjectKey.slice(separator + 1);
  const slash = coordinate.indexOf("/");
  if (slash <= 0 || slash === coordinate.length - 1) return null;
  const namespace = coordinate.slice(0, slash);
  const name = coordinate.slice(slash + 1);
  if (
    !REPOSITORY_PROVIDER_PATTERN.test(provider) ||
    !REPOSITORY_SEGMENT_PATTERN.test(namespace) ||
    !REPOSITORY_SEGMENT_PATTERN.test(name)
  ) {
    return null;
  }
  return { provider, namespace, name };
}

/** Trim an AWS account id and reject anything that is not 12 digits. */
export function normalizeAwsAccountId(accountId: string): string {
  const normalized = accountId?.trim() ?? "";
  if (!AWS_ACCOUNT_ID_PATTERN.test(normalized)) {
    throw new BadRequestException(`AWS account id "${accountId}" must be 12 digits.`);
  }
  return normalized;
}

/** Trim, drop empties and deduplicate a region list, keeping submission order. */
export function normalizeAwsRegions(regions: readonly string[] | undefined): string[] | undefined {
  if (regions === undefined) return undefined;
  return [...new Set(regions.map((region) => region.trim()).filter((region) => region.length > 0))];
}

function normalizeSegment(value: string, field: string): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.length === 0 || normalized.length > REPOSITORY_SEGMENT_MAX_LENGTH) {
    throw new BadRequestException(`Repository ${field} must be 1…${REPOSITORY_SEGMENT_MAX_LENGTH} characters.`);
  }
  if (!REPOSITORY_SEGMENT_PATTERN.test(normalized)) {
    throw new BadRequestException(`Repository ${field} "${value}" must not contain ":", "/" or whitespace.`);
  }
  return normalized;
}
