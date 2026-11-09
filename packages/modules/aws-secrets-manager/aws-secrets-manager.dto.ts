import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  buildMessage,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidationOptions,
} from "class-validator";
import {
  ENV_GROUP_MAX_VARS,
  ENV_VAR_KEY_MAX_LENGTH,
  ENV_VAR_KEY_PATTERN,
  ENV_VAR_VALUE_MAX_LENGTH,
  SECRET_TYPES,
  SECRET_VALUE_TYPES,
  SecretType,
  SecretValueType,
} from "./aws-secrets-manager.types";

/** Default/maximum page size mirrors the AWS ListSecrets MaxResults ceiling. */
export const DEFAULT_LIST_PAGE_SIZE = 100;
export const MAX_LIST_PAGE_SIZE = 100;

/** Secret payload accepted on the write path: a JSON object or a non-empty plain-text string. */
export type SecretValuePayload = Record<string, unknown> | string;

/**
 * Accepts a key/value JSON object or a non-empty plain-text string. Arrays,
 * numbers, booleans and null are rejected; a JSON object is serialized by the
 * service, while a string is stored verbatim.
 */
export function IsSecretValue(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isSecretValue",
      validator: {
        validate: (value: unknown): boolean => {
          if (typeof value === "string") {
            return value.length > 0;
          }
          return typeof value === "object" && value !== null && !Array.isArray(value);
        },
        defaultMessage: buildMessage(
          (eachPrefix) => `${eachPrefix}$property must be a non-empty string or a plain object`,
        ),
      },
    },
    validationOptions,
  );
}

/**
 * Secret metadata mirrored from AWS Secrets Manager (the single source of truth).
 * The actual secret value is only returned by the dedicated value endpoint.
 */
export class SecretResponseDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  arn!: string;

  @ApiPropertyOptional({ type: String })
  description?: string | null;

  @ApiPropertyOptional({ enum: SECRET_TYPES })
  type?: SecretType | null;

  @ApiProperty({ type: String })
  region!: string;

  @ApiProperty({ type: Boolean })
  isRotationEnabled!: boolean;

  @ApiPropertyOptional({ type: String })
  rotationLambdaArn?: string | null;

  @ApiPropertyOptional({ type: Object })
  rotationRules?: object | null;

  @ApiPropertyOptional({ type: Date })
  lastRotatedAt?: Date | null;

  @ApiPropertyOptional({ type: Date })
  lastChangedAt?: Date | null;

  @ApiPropertyOptional({ type: Date })
  createdAt?: Date | null;
}

export class ListSecretsResponseDto {
  @ApiProperty({ type: SecretResponseDto, isArray: true })
  records!: SecretResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Opaque cursor for the next page; pass it back as nextToken. Null when no more pages",
  })
  nextToken!: string | null;
}

export class ListSecretsRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    description: "Number of records per page (1-100)",
    default: DEFAULT_LIST_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_LIST_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_PAGE_SIZE)
  pageSize?: number;

  @ApiPropertyOptional({ description: "Opaque pagination token returned by the previous call" })
  @IsOptional()
  @IsString()
  nextToken?: string;
}

export class GetSecretRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class CreateSecretDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  @ApiProperty({
    description: "Secret name; letters, digits and /_+=.@- excluding slash (used as URL path parameter)",
  })
  @IsString()
  @Matches(/^[a-zA-Z0-9_+=.@-]{1,512}$/)
  name!: string;

  @ApiProperty({ enum: SECRET_TYPES, description: "Secret type" })
  @Type(() => String)
  @IsIn(SECRET_TYPES)
  type!: SecretType;

  // eslint-disable-next-line @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator -- union payload (object | string) enforced by IsSecretValue()
  @ApiProperty({
    description: "Secret value: a JSON object (stored as JSON) or a non-empty string (stored verbatim)",
    oneOf: [
      { type: "object", additionalProperties: true },
      { type: "string", minLength: 1 },
    ],
  })
  @IsDefined()
  @IsSecretValue()
  secretValue!: SecretValuePayload;

  @ApiPropertyOptional({ description: "Secret description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class UpdateSecretDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  // eslint-disable-next-line @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator -- union payload (object | string) enforced by IsSecretValue()
  @ApiPropertyOptional({
    description: "New secret value: a JSON object (stored as JSON) or a non-empty string (stored verbatim)",
    oneOf: [
      { type: "object", additionalProperties: true },
      { type: "string", minLength: 1 },
    ],
  })
  @IsOptional()
  @IsSecretValue()
  secretValue?: SecretValuePayload;

  @ApiPropertyOptional({ description: "New description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: SECRET_TYPES, description: "New secret type" })
  @Type(() => String)
  @IsOptional()
  @IsIn(SECRET_TYPES)
  type?: SecretType;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class SetRotationRequestDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  @ApiProperty({ description: "Enable or disable automatic rotation" })
  @IsBoolean()
  isEnabled!: boolean;

  @ApiPropertyOptional({ description: "Rotation interval in days (defaults to 30)", default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class GetSecretValueResponseDto {
  @ApiProperty({ description: "Secret name" })
  name!: string;

  @ApiProperty({
    description: "Decrypted value: an object when valueType=json, raw text for text, base64 for binary",
    oneOf: [{ type: "object", additionalProperties: true }, { type: "string" }],
  })
  secretValue!: SecretValuePayload;

  @ApiProperty({ enum: SECRET_VALUE_TYPES, description: "Payload encoding of the secretValue field" })
  valueType!: SecretValueType;
}

export class DeleteSecretResponseDto {
  @ApiProperty({ description: "Name of the deleted secret" })
  name!: string;
}

// ─── Env group (one application = one group secret) ───────────────────────────

/**
 * Accepts a flat map of shell-style variable names to string values. Arrays,
 * nested objects and non-string values are rejected; the group JSON contract
 * keeps `env` directly injectable by a deployment process.
 */
export function IsEnvVarMap(validationOptions?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: "isEnvVarMap",
      validator: {
        validate: (value: unknown): boolean => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return false;
          }
          const entries = Object.entries(value);
          if (entries.length > ENV_GROUP_MAX_VARS) {
            return false;
          }
          return entries.every(([key, val]) => {
            return (
              key.length <= ENV_VAR_KEY_MAX_LENGTH &&
              ENV_VAR_KEY_PATTERN.test(key) &&
              typeof val === "string" &&
              val.length <= ENV_VAR_VALUE_MAX_LENGTH
            );
          });
        },
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a flat map of valid variable names to string values ` +
            `(max ${ENV_GROUP_MAX_VARS} entries)`,
        ),
      },
    },
    validationOptions,
  );
}

export class UpdateEnvGroupDto {
  @ApiProperty({ description: "Project ID (resolves the AWS credential and region)" })
  @IsString()
  projectId!: string;

  // eslint-disable-next-line @darraghor/nestjs-typed/validated-non-primitive-property-needs-type-decorator -- flat map enforced by IsEnvVarMap()
  @ApiProperty({
    description: "Complete env map for this group; replaces the previous map atomically",
    type: "object",
    additionalProperties: { type: "string" },
  })
  @IsDefined()
  @IsEnvVarMap()
  env!: Record<string, string>;

  @ApiPropertyOptional({ description: "AWS region override (defaults to the credential default region)" })
  @IsOptional()
  @IsString()
  region?: string;
}

export class EnvGroupResponseDto {
  @ApiProperty({ description: "Composed secret name: nw/<projectId>/<groupId>/env" })
  groupName!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Secret ARN; null when the group does not exist yet",
  })
  arn?: string | null;

  @ApiProperty({ description: "Whether the group secret exists in AWS Secrets Manager" })
  exists!: boolean;

  @ApiProperty({
    description: "Flat env map; empty when the group does not exist yet",
    type: "object",
    additionalProperties: { type: "string" },
  })
  env!: Record<string, string>;

  @ApiPropertyOptional({ type: Date, nullable: true })
  lastChangedAt?: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  createdAt?: Date | null;
}

export class DeleteEnvGroupResponseDto {
  @ApiProperty({ description: "Composed secret name that was deleted" })
  groupName!: string;
}
