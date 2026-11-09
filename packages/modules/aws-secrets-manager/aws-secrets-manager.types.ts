/**
 * Secret types supported by the management plane. Stored on the AWS secret as
 * the `devbie:secret-type` tag (the AWS Secrets Manager entry is the single
 * source of truth; there is no local database mirror).
 */
export const SECRET_TYPES = ["RDS_CREDENTIALS", "DOCUMENTDB_CREDENTIALS", "AWS_API_KEY", "GENERIC_SECRET"] as const;

export type SecretType = (typeof SECRET_TYPES)[number];

/** Tag marking a secret as managed by this management plane. */
export const MANAGED_TAG_KEY = "devbie:managed";

/** Tag carrying the {@link SecretType} of a managed secret. */
export const SECRET_TYPE_TAG_KEY = "devbie:secret-type";

/**
 * Payload encoding returned by the value endpoint:
 * - json: SecretString parsed as a JSON object
 * - text: SecretString returned verbatim (plain text or a non-object JSON document)
 * - binary: SecretBinary re-encoded as base64 (the write path does not accept binary)
 */
export const SECRET_VALUE_TYPES = ["json", "text", "binary"] as const;

export type SecretValueType = (typeof SECRET_VALUE_TYPES)[number];

/**
 * Env group contract (ADR-005 §4): one application owns exactly one secret
 * holding its environment variables. The secret name encodes the project and
 * the host grouping entity (groupId = host application id), so the AWS account
 * itself enforces project isolation while the group id stays an opaque owner
 * reference the module never interprets.
 */
export const ENV_GROUP_NAME_PREFIX = "nw";
export const ENV_GROUP_NAME_SUFFIX = "env";
/** Field inside the group JSON that carries the flat, injectable env map. */
export const ENV_GROUP_ENV_FIELD = "env";
/**
 * Reserved key describing the rotation recipe (ADR-005 §5). It is preserved
 * verbatim on every group write and is not exposed as an env variable.
 */
export const ENV_GROUP_ROTATION_FIELD = "__rotation";

/** Composed secret name: nw/<projectId>/<groupId>/env. */
export function envGroupSecretName(projectId: string, groupId: string): string {
  return `${ENV_GROUP_NAME_PREFIX}/${projectId}/${groupId}/${ENV_GROUP_NAME_SUFFIX}`;
}

/** Shell-style variable name accepted inside a group. */
export const ENV_VAR_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ENV_VAR_KEY_MAX_LENGTH = 128;
export const ENV_VAR_VALUE_MAX_LENGTH = 4096;
/** Upper bound on variables per group (Secrets Manager 64 KB SecretString limit guard). */
export const ENV_GROUP_MAX_VARS = 200;

/** Audit resourceType carried by every secret audit row. */
export const SECRET_AUDIT_RESOURCE_TYPE = "secret";

/**
 * Business audit events emitted by this module (open "domain.action" set
 * consumed by AuditLogService). The generic HTTP interceptor row is skipped
 * on the mutating routes because it cannot resolve the `:name` resource.
 */
export const SECRET_AUDIT_EVENTS = {
  VALUE_READ: "secret.value_read",
  CREATED: "secret.created",
  UPDATED: "secret.updated",
  DELETED: "secret.deleted",
  ROTATED: "secret.rotated",
  ROTATION_CONFIGURED: "secret.rotation_configured",
  ENV_GROUP_READ: "env_group.value_read",
  ENV_GROUP_UPDATED: "env_group.updated",
  ENV_GROUP_DELETED: "env_group.deleted",
} as const;
