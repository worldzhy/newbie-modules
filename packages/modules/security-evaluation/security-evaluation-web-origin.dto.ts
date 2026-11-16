import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import {
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS,
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES,
  type SecurityEvaluationWebOriginVerificationMethod,
  type SecurityEvaluationWebOriginVerificationStatus,
} from "./security-evaluation.constants";

/**
 * Wire shapes of the web-origin verification state machine (ADR-071).
 *
 * A web origin is a subject on its own, so its material is read through
 * `GET /security-evaluation/subjects/:subjectId/material` — never through a
 * kind-scoped route, and never with the token attached. These DTOs only cover
 * the two verification calls that hang off that material; the token appears in
 * the challenge alone, because it belongs to the act of verifying.
 */
export class RequestWebOriginVerificationDto {
  @ApiProperty({
    enum: [...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS],
    description: "Channel the operator publishes the token on.",
  })
  @IsEnum([...SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_METHODS])
  method!: SecurityEvaluationWebOriginVerificationMethod;
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
