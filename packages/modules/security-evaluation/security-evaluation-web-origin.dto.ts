import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import {
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS,
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES,
  type SecurityEvaluationWebOriginVerificationMethod,
  type SecurityEvaluationWebOriginVerificationStatus,
} from "./security-evaluation.constants";

/**
 * HTTP surface of the module-owned web-origin registration (ADR-044 §2, §6).
 * Platform-level: an origin is a subject on its own, not a project-owned row
 * (ADR-068 D8). The module service validates origin normalization, path roles
 * and the verification lifecycle; these DTOs only shape the wire and bound the
 * payload.
 */
export class RegisterWebOriginDto {
  @ApiProperty({
    type: String,
    description: "Origin as scheme://host[:port]. Paths are configured through targetPaths, never in the origin.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  origin!: string;

  @ApiPropertyOptional({ type: String, description: "Label shown in the UI; defaults to the normalized origin." })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
    description: 'Path role → relative path, e.g. { "auth.login": "/login" }. Unknown roles are rejected.',
  })
  @IsOptional()
  @IsObject()
  targetPaths?: Record<string, string>;
}

export class RequestWebOriginVerificationDto {
  @ApiProperty({
    enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS],
    description: "Channel the operator publishes the token on.",
  })
  @IsEnum([...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS])
  method!: SecurityEvaluationWebOriginVerificationMethod;
}

export class GetSecurityEvaluationWebOriginRequestDto {
  @ApiProperty({ type: String })
  @IsString()
  @IsNotEmpty()
  subjectId!: string;
}

export class WebOriginRegistrationDto {
  @ApiProperty({ type: String })
  subjectId!: string;

  @ApiProperty({ type: String })
  webOriginId!: string;

  @ApiProperty({ type: String, description: "Normalized origin (the subject's key)." })
  origin!: string;

  @ApiProperty({ enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES] })
  verificationStatus!: SecurityEvaluationWebOriginVerificationStatus;

  @ApiProperty({ type: String, description: "Token the operator publishes for the chosen method." })
  verificationToken!: string;
}

export class WebOriginChallengeDto {
  @ApiProperty({ type: String })
  subjectId!: string;

  @ApiProperty({ type: String })
  origin!: string;

  @ApiProperty({ enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS] })
  method!: SecurityEvaluationWebOriginVerificationMethod;

  @ApiProperty({ type: String })
  token!: string;

  @ApiPropertyOptional({ type: String, description: "TXT record name to publish (DNS_TXT)." })
  dnsRecordName?: string;

  @ApiPropertyOptional({ type: String, description: "TXT record value to publish (DNS_TXT)." })
  dnsRecordValue?: string;

  @ApiPropertyOptional({ type: String, description: "URL that must serve the token (WELL_KNOWN)." })
  wellKnownUrl?: string;
}

export class WebOriginVerificationResultDto {
  @ApiProperty({ type: String })
  subjectId!: string;

  @ApiProperty({ type: String })
  origin!: string;

  @ApiProperty({ enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES] })
  status!: SecurityEvaluationWebOriginVerificationStatus;

  @ApiProperty({ type: Date, nullable: true, description: "First successful verification; null before it." })
  verifiedAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: "Most recent successful verification." })
  lastVerifiedAt!: Date | null;

  @ApiProperty({ type: Number, description: "Consecutive failed verifications; reset on success." })
  consecutiveFailures!: number;
}

export class WebOriginDetailDto {
  @ApiProperty({ type: String })
  subjectId!: string;

  @ApiProperty({ type: String, description: "Normalized origin (the subject's key)." })
  origin!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({
    type: "object",
    additionalProperties: { type: "string" },
    description: "Path role → relative path.",
  })
  targetPaths!: Record<string, string>;

  @ApiProperty({ enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES] })
  verificationStatus!: SecurityEvaluationWebOriginVerificationStatus;

  @ApiProperty({ enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS], nullable: true })
  verificationMethod!: SecurityEvaluationWebOriginVerificationMethod | null;

  @ApiProperty({ type: String, description: "Token the operator publishes for the chosen method." })
  verificationToken!: string;

  @ApiProperty({ type: Number })
  verificationFailureCount!: number;

  @ApiProperty({ type: Date, nullable: true })
  verifiedAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  lastVerifiedAt!: Date | null;

  @ApiProperty({ type: Boolean, description: "False stops the origin from entering the evaluation pipeline." })
  isActive!: boolean;

  @ApiProperty({ type: Date })
  createdAt!: Date;

  @ApiProperty({ type: Date })
  updatedAt!: Date;
}
