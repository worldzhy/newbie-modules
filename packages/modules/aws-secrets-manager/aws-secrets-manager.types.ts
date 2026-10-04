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
