import { ApiProperty } from "@nestjs/swagger";
import {
  SECURITY_EVALUATION_WEB_ORIGIN_VERIFICATION_STATUSES,
  type SecurityEvaluationWebOriginVerificationStatus,
} from "./security-evaluation.constants";

/**
 * Wire shapes of the web-origin verification state machine (ADR-074).
 *
 * The verification details travel with the material read: the token is public by
 * construction (it must be published at the operator's own origin), so the guard
 * is the endpoint permission plus a server-side probe, never secrecy. Both
 * placements are described at once — the check probes DNS first and falls back
 * to `.well-known` — and `verificationMethod` records which one answered.
 */
export class WebOriginDnsTxtDto {
  @ApiProperty({ description: "TXT record name to publish." })
  name!: string;

  @ApiProperty({ description: "TXT record value to publish." })
  value!: string;
}

export class WebOriginWellKnownDto {
  @ApiProperty({ description: "URL that must serve the token." })
  url!: string;
}

/** What the operator publishes while an origin is `PENDING` or `FAILED`. */
export class WebOriginVerificationDto {
  @ApiProperty({ type: String })
  token!: string;

  @ApiProperty({ type: () => WebOriginDnsTxtDto })
  dnsTxt!: WebOriginDnsTxtDto;

  @ApiProperty({ type: () => WebOriginWellKnownDto })
  wellKnown!: WebOriginWellKnownDto;
}

/** Outcome of a `POST .../material/verification/checks` run. */
export class WebOriginVerificationCheckResponseDto {
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
