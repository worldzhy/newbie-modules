import { ApiProperty } from "@nestjs/swagger";
import {
  SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT,
  SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY,
  SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN,
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS,
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES,
  type SecurityEvaluationWebOriginVerificationMethod,
  type SecurityEvaluationWebOriginVerificationStatus,
} from "./security-evaluation.constants";
import { WebOriginVerificationDto } from "./security-evaluation-web-origin.dto";

/**
 * Material of one subject (ADR-071, ADR-074).
 *
 * Material belongs to the subject, not to its kind: every material table keys on
 * `subjectId @unique`, and ingest writes the subject first and the material
 * second. The read path therefore hangs off the subject (`subjects/:subjectId
 * /material`) and the payload is a discriminated union — a new kind adds a union
 * branch, never a new route. The web-origin branch carries the verification
 * details while verification is outstanding (ADR-074 D1): the token has to be
 * published at the operator's own origin, so treating it as a secret bought
 * nothing and forced a read to go through a write.
 */
export class SecurityEvaluationWebOriginMaterialDto {
  @ApiProperty({ enum: [SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN] })
  kind!: typeof SECURITY_EVALUATION_SUBJECT_KIND_WEB_ORIGIN;

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

  @ApiProperty({
    type: () => WebOriginVerificationDto,
    nullable: true,
    description:
      "Token and both placements to publish while PENDING/FAILED; null once VERIFIED or REVOKED (ADR-074 D1).",
  })
  verification!: WebOriginVerificationDto | null;

  @ApiProperty({ type: Number, description: "Consecutive failed verifications; reset on success." })
  verificationFailureCount!: number;

  @ApiProperty({ type: Date, nullable: true, description: "First successful verification; null before it." })
  verifiedAt!: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: "Most recent successful verification." })
  lastVerifiedAt!: Date | null;

  @ApiProperty() isActive!: boolean;
}

export class SecurityEvaluationRepositoryMaterialDto {
  @ApiProperty({ enum: [SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY] })
  kind!: typeof SECURITY_EVALUATION_SUBJECT_KIND_REPOSITORY;

  @ApiProperty({ description: 'Code host provider, e.g. "github" or "bitbucket"' })
  provider!: string;

  @ApiProperty({ description: "First segment of the repository coordinate (owner / workspace)" })
  namespace!: string;

  @ApiProperty({ description: "Repository name (last segment of the coordinate)" })
  name!: string;

  @ApiProperty({ type: String, nullable: true, description: "Browsable repository URL, stored verbatim" })
  url!: string | null;

  @ApiProperty() isActive!: boolean;
}

export class SecurityEvaluationAwsAccountMaterialDto {
  @ApiProperty({ enum: [SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT] })
  kind!: typeof SECURITY_EVALUATION_SUBJECT_KIND_AWS_ACCOUNT;

  @ApiProperty({ description: "12-digit AWS account id — the natural key of the subject" })
  accountId!: string;

  @ApiProperty({ type: String, nullable: true, description: "Region collection default, e.g. us-east-1" })
  defaultRegion!: string | null;

  @ApiProperty({ type: String, isArray: true, description: "Regions collected for this account" })
  regions!: string[];

  @ApiProperty() isActive!: boolean;
}

export type SecurityEvaluationSubjectMaterial =
  | SecurityEvaluationWebOriginMaterialDto
  | SecurityEvaluationRepositoryMaterialDto
  | SecurityEvaluationAwsAccountMaterialDto;
