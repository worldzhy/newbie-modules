import { Type } from "class-transformer";
import {
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import {
  EvaluationFindingSeverity,
  EvaluationFindingStatus,
  EvaluationRemediationStatus,
  EvaluationResultReviewStatus,
} from "@generated/prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

export class GetEvaluationFindingByIdRequestDto {
  @ApiProperty({ description: "Finding the decision applies to" })
  @IsUUID()
  id!: string;
}

export class SuppressEvaluationFindingRequestDto {
  @ApiProperty({ description: "Why a human silenced this finding; kept on the finding for audit" })
  @IsString()
  note!: string;
}

export class GetEvaluationResultByIdRequestDto {
  @ApiProperty({ description: "Result the review applies to" })
  @IsUUID()
  id!: string;
}

export class ReviewEvaluationResultRequestDto {
  @ApiProperty({
    enum: EvaluationResultReviewStatus,
    description: "APPROVED endorses the archived AI conclusion, REJECTED overrules it",
  })
  @IsEnum(EvaluationResultReviewStatus)
  reviewStatus!: EvaluationResultReviewStatus;

  @ApiPropertyOptional({
    description: "Why the supervisor endorsed or overruled the conclusion — mandatory when REJECTED",
  })
  @ValidateIf((o) => o.reviewStatus === EvaluationResultReviewStatus.REJECTED)
  @IsString()
  @IsNotEmpty({ message: "note is required when reviewStatus is REJECTED" })
  note?: string;
}

export class EvaluationRemediationCheckpointRequestDto {
  @ApiProperty({ description: "What counts as done for this checkpoint" })
  @IsString()
  description!: string;

  @ApiProperty({
    description: "Checkpoint target date (ISO date string); parseability is validated by the remediation service",
  })
  @IsString()
  dueDate!: string;

  @ApiProperty({ description: "Checkpoint status (PENDING/DONE/SKIPPED)" })
  @IsString()
  status!: string;
}

export class CreateEvaluationRemediationPlanRequestDto {
  @ApiProperty({ description: "Subject the plan answers to" })
  @IsUUID()
  subjectId!: string;

  @ApiProperty({ type: String, isArray: true, description: "Finding or result ids the plan responds to" })
  @IsArray()
  @IsString({ each: true })
  triggerIds!: string[];

  @ApiProperty({ description: "Accountable decision maker as a host actor reference; never derived from the caller" })
  @IsString()
  decider!: string;

  @ApiProperty({ type: Date, description: "Calendar day the plan starts (sent as ISO date, stored date-only)" })
  @Type(() => Date)
  @IsDate()
  startOn!: Date;

  @ApiPropertyOptional({ type: Date, description: "Calendar day the plan is due (stored date-only)" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueOn?: Date;

  @ApiPropertyOptional({
    type: EvaluationRemediationCheckpointRequestDto,
    isArray: true,
    description: "Ordered checkpoints; deep consistency is validated by the remediation service",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationRemediationCheckpointRequestDto)
  checkpoints?: EvaluationRemediationCheckpointRequestDto[];
}

export class GetEvaluationRemediationPlanByIdRequestDto {
  @ApiProperty({ description: "Plan id" })
  @IsUUID()
  id!: string;
}

const DECIDABLE_REMEDIATION_PLAN_STATUSES = {
  COMPLETED: EvaluationRemediationStatus.COMPLETED,
  CANCELLED: EvaluationRemediationStatus.CANCELLED,
} as const;

export class DecideEvaluationRemediationPlanRequestDto {
  @ApiProperty({ enum: DECIDABLE_REMEDIATION_PLAN_STATUSES })
  @IsEnum(DECIDABLE_REMEDIATION_PLAN_STATUSES)
  status!: "COMPLETED" | "CANCELLED";

  @ApiPropertyOptional({ description: "Why the plan was completed or cancelled" })
  @IsOptional()
  @IsString()
  decisionNote?: string;
}

export class UpdateEvaluationRemediationCheckpointRequestDto {
  @ApiProperty({ description: "New checkpoint status (PENDING/DONE/SKIPPED)" })
  @IsString()
  status!: string;
}

export class ListEvaluationRemediationPlansRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose plans are listed (newest first)" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ enum: EvaluationRemediationStatus, description: "Restrict to one plan status" })
  @IsOptional()
  @IsEnum(EvaluationRemediationStatus)
  status?: EvaluationRemediationStatus;
}

export class EvaluationFindingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ description: "Feature standardKey that observed the finding, e.g. npm-osv, aws-cis-1.5, work" })
  standardKey!: string;
  @ApiProperty({ description: "Stable logical identity used to dedupe across runs" })
  fingerprint!: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity })
  severity!: EvaluationFindingSeverity;
  @ApiProperty({ enum: EvaluationFindingStatus })
  status!: EvaluationFindingStatus;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ description: "Optional long-form text explaining the finding", type: String })
  description?: string | null;
  @ApiPropertyOptional({ type: Object }) metadata?: object | null;
  @ApiProperty({ description: "Run that first observed this fingerprint for the subject" })
  firstSeenRunId!: string;
  @ApiProperty({ description: "Run that most recently re-observed this fingerprint" })
  lastSeenRunId!: string;
  @ApiPropertyOptional({ type: Date }) firstSeenAt?: Date | null;
  @ApiPropertyOptional({ type: Date }) lastSeenAt?: Date | null;
  @ApiPropertyOptional({ type: Date }) resolvedAt?: Date | null;
  @ApiPropertyOptional({ type: String, description: "Human note recorded when the finding was suppressed" })
  suppressionNote?: string | null;
  @ApiPropertyOptional({ type: Date, description: "When the finding was suppressed" })
  suppressedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class EvaluationRemediationPlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ type: String, isArray: true }) triggerIds!: string[];
  @ApiPropertyOptional({ type: Object, description: "Ordered checkpoints with { dueDate, description, status }" })
  checkpoints?: object | null;
  @ApiProperty({ enum: EvaluationRemediationStatus })
  status!: EvaluationRemediationStatus;
  @ApiProperty({ type: Date, description: "Calendar day the plan starts (date-only)" }) startOn!: Date;
  @ApiPropertyOptional({ type: Date, description: "Calendar day the plan is due (date-only)" }) dueOn?: Date | null;
  @ApiProperty({ description: "Accountable decision maker as a host actor reference" })
  decider!: string;
  @ApiPropertyOptional({ type: String }) decisionNote?: string | null;
  @ApiPropertyOptional({ type: Date }) decidedAt?: Date | null;
  @ApiPropertyOptional({ type: Date }) closedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class EvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: "SHA-256 over the canonical manifest, computed by the skeleton" })
  manifestHash!: string;
  @ApiProperty({
    type: Object,
    description: "{ evaluated, declaredUnlinked, skipped } — what the judgment saw and what it did not",
  })
  coverageStats!: object;
  @ApiProperty({
    type: Object,
    description: "Scored verdicts: [{ criterionKey, score, confidence, coverage, evidenceRefs, rationale }]",
  })
  verdicts!: object;
  @ApiPropertyOptional({ type: String }) summary?: string | null;
  @ApiPropertyOptional({ type: Object }) metadata?: object | null;
  @ApiPropertyOptional({
    enum: EvaluationResultReviewStatus,
    description: "Supervisor verdict on the archived conclusion (ADR-031)",
  })
  reviewStatus?: EvaluationResultReviewStatus | null;
  @ApiPropertyOptional({ type: Date, description: "When the review was recorded" })
  reviewedAt?: Date | null;
  @ApiPropertyOptional({ type: String, description: "Reviewer's note; cleared when a re-review omits it" })
  reviewNote?: string | null;
  @ApiProperty() createdAt!: Date;
}

export class ListEvaluationRemediationPlansResponseDto extends CommonListResponseDto<EvaluationRemediationPlanResponseDto> {
  @ApiProperty({ type: EvaluationRemediationPlanResponseDto, isArray: true })
  declare records: EvaluationRemediationPlanResponseDto[];
}
