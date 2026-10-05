/**
 * Secret types supported by the management plane. Stored on the AWS secret as
 * the `nightwatch:secret-type` tag (the AWS Secrets Manager entry is the single
 * source of truth; there is no local database mirror).
 */
export const SECRET_TYPES = ["RDS_CREDENTIALS", "DOCUMENTDB_CREDENTIALS", "AWS_API_KEY", "GENERIC_SECRET"] as const;

export type SecretType = (typeof SECRET_TYPES)[number];

/** Tag marking a secret as managed by the nightwatch plane. */
export const MANAGED_TAG_KEY = "nightwatch:managed";

/** Tag carrying the {@link SecretType} of a managed secret. */
export const SECRET_TYPE_TAG_KEY = "nightwatch:secret-type";

/**
 * Payload encoding returned by the value endpoint:
 * - json: SecretString parsed as a JSON object
 * - text: SecretString returned verbatim (plain text or a non-object JSON document)
 * - binary: SecretBinary re-encoded as base64 (the write path does not accept binary)
 */
export const SECRET_VALUE_TYPES = ["json", "text", "binary"] as const;

export type SecretValueType = (typeof SECRET_VALUE_TYPES)[number];
