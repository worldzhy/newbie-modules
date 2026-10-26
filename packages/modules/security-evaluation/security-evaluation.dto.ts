import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from "class-validator";
import { EvaluationFindingSeverity, EvaluationFindingStatus, EvaluationRunStatus } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

// --- Path params ---------------------------------------------------------

/** Path-parameter envelope for asset-scoped routes. */
export class GetSecurityEvaluationAssetRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  assetId!: string;
}

// --- Subject sync --------------------------------------------------------

export class SyncSecurityEvaluationSubjectsRequestDto {
  @ApiProperty({ description: "Host-assigned scope type the subjects are declared under" })
  @IsString()
  @IsNotEmpty()
  scopeType!: string;

  @ApiProperty({ description: "Host-assigned scope id the subjects are declared under" })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}

export class SyncSecurityEvaluationSubjectsResponseDto {
  @ApiProperty({ description: "Subjects synchronised from the host provider" })
  subjects!: number;
}

// --- Assets --------------------------------------------------------------

export class ListSecurityEvaluationAssetsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Host-assigned scope type the assets are listed under" })
  @IsString()
  @IsNotEmpty()
  scopeType!: string;

  @ApiProperty({ description: "Host-assigned scope id the assets are listed under" })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}

/** Mirrors the SecurityEvaluationAsset row. */
export class SecurityEvaluationAssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ description: "Stable identity inside the scope: repository full name or cloud account id" })
  naturalKey!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() firstSeenAt!: Date;
  @ApiProperty({ description: "Last run that actually observed this asset's inventory" })
  lastSeenAt!: Date;
}

export class ListSecurityEvaluationAssetsResponseDto extends CommonListResponseDto<SecurityEvaluationAssetResponseDto> {}

// --- Asset facts ---------------------------------------------------------

export class ListSecurityEvaluationAssetFactsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: 'Restrict to one fact type, e.g. "package"' })
  @IsOptional()
  @IsString()
  factType?: string;
}

/** Mirrors the SecurityEvaluationAssetFact row. */
export class SecurityEvaluationAssetFactResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() assetId!: string;
  @ApiProperty({ description: 'Fact vocabulary type, e.g. "package"' }) factType!: string;
  @ApiProperty({ description: 'Fact identity, e.g. "npm:lodash@4.17.20"' }) factKey!: string;
  @ApiPropertyOptional({
    type: Object,
    description: "Small intrinsic values: version, isDev, ecosystem, region…",
  })
  value?: object | null;
  @ApiProperty({ description: "When this fact was last observed" }) observedAt!: Date;
}

export class ListSecurityEvaluationAssetFactsResponseDto extends CommonListResponseDto<SecurityEvaluationAssetFactResponseDto> {}

// --- Runs ----------------------------------------------------------------

/**
 * Request to open a dependency evaluation run. The trigger is fire-and-forget:
 * the skeleton runner owns the lifecycle, so the response is a bare
 * acknowledgement and the caller discovers the run through
 * `GET /security-evaluation/runs?subjectId=`.
 */
export class StartSecurityEvaluationRunRequestDto {
  @ApiProperty({ description: 'Evaluation subject (kind "repository") to evaluate' })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: "Override criteria version — defaults to the version this build ships" })
  @IsOptional()
  @IsUUID()
  criteriaVersionId?: string;

  @ApiPropertyOptional({ type: Object, description: "Opaque per-run config (ADR-023)" })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/** Minimal acknowledgement of a fire-and-forget run trigger (HTTP 202). */
export class SecurityEvaluationRunAcceptedResponseDto {
  @ApiProperty({ description: "The run was dispatched; poll the run list for its row" })
  accepted!: boolean;
}

export class ListSecurityEvaluationRunsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose runs are listed (newest first)" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: "Restrict to one criteria version" })
  @IsOptional()
  @IsUUID()
  criteriaVersionId?: string;
}

/** Mirrors the skeleton's EvaluationRun row. */
export class SecurityEvaluationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() criteriaVersionId!: string;
  @ApiProperty({ enum: EvaluationRunStatus }) status!: EvaluationRunStatus;
  @ApiPropertyOptional({ type: String }) requestedByRef?: string | null;
  @ApiPropertyOptional({ type: Object }) config?: object | null;
  @ApiPropertyOptional({ description: "Failure reason when status is FAILED", type: String })
  error?: string | null;
  @ApiPropertyOptional({ type: Date }) startedAt?: Date | null;
  @ApiPropertyOptional({ type: Date }) finishedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListSecurityEvaluationRunsResponseDto extends CommonListResponseDto<SecurityEvaluationRunResponseDto> {}

// --- Results -------------------------------------------------------------

export class ListSecurityEvaluationResultsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose archived results are listed (newest first)" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: "Restrict to one criteria version" })
  @IsOptional()
  @IsUUID()
  criteriaVersionId?: string;
}

/** Mirrors the skeleton's EvaluationResult read shape (manifest excluded). */
export class SecurityEvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() criteriaVersionId!: string;
  @ApiProperty({ description: "SHA-256 over the archived manifest" }) contentHash!: string;
  @ApiProperty({ type: Object, description: "{ evaluated, declaredUnlinked, skipped } coverage buckets" })
  coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true, description: "Scored verdicts by criterionKey" })
  verdicts!: object[];
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional({ type: Object, description: "Judgment execution facts" })
  metadata?: object | null;
  @ApiProperty() createdAt!: Date;
}

export class ListSecurityEvaluationResultsResponseDto extends CommonListResponseDto<SecurityEvaluationResultResponseDto> {}

// --- Findings ------------------------------------------------------------

export class ListSecurityEvaluationFindingsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose findings are listed" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: 'Restrict to one criteria family, e.g. "dependency-osv"' })
  @IsOptional()
  @IsString()
  family?: string;

  @ApiPropertyOptional({ enum: EvaluationFindingStatus })
  @IsOptional()
  @IsEnum(EvaluationFindingStatus)
  status?: EvaluationFindingStatus;

  @ApiPropertyOptional({ enum: EvaluationFindingSeverity })
  @IsOptional()
  @IsEnum(EvaluationFindingSeverity)
  severity?: EvaluationFindingSeverity;
}

/** Mirrors the skeleton's EvaluationFinding row. */
export class SecurityEvaluationFindingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() family!: string;
  @ApiProperty() fingerprint!: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity }) severity!: EvaluationFindingSeverity;
  @ApiProperty({ enum: EvaluationFindingStatus }) status!: EvaluationFindingStatus;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String }) detail?: string | null;
  @ApiPropertyOptional({ type: Object }) metadata?: object | null;
  @ApiPropertyOptional({ type: String }) firstSeenRunId?: string | null;
  @ApiPropertyOptional({ type: String }) lastSeenRunId?: string | null;
  @ApiProperty() firstSeenAt!: Date;
  @ApiProperty() lastSeenAt!: Date;
  @ApiPropertyOptional({ type: Date }) resolvedAt?: Date | null;
  @ApiPropertyOptional({ type: String }) suppressionNote?: string | null;
  @ApiPropertyOptional({ type: String }) suppressedByRef?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListSecurityEvaluationFindingsResponseDto extends CommonListResponseDto<SecurityEvaluationFindingResponseDto> {}

// --- Report --------------------------------------------------------------

export class GetSecurityEvaluationReportRequestDto {
  @ApiProperty({ description: "Host-assigned scope type the report is built for" })
  @IsString()
  @IsNotEmpty()
  scopeType!: string;

  @ApiProperty({ description: "Host-assigned scope id the report is built for" })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}

export class SecurityEvaluationReportAssetsDto {
  @ApiProperty() total!: number;
  @ApiProperty({ description: "Assets not observed within the staleness window" })
  stale!: number;
  @ApiPropertyOptional({ type: Date }) lastObservedAt?: Date | null;
}

export class SecurityEvaluationReportCoverageDto {
  @ApiProperty() evaluated!: number;
  @ApiProperty() declaredUnlinked!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty({ description: "Assets that have at least one archived result" }) assetsWithResult!: number;
}

export class SecurityEvaluationReportTopFindingDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity }) severity!: EvaluationFindingSeverity;
  @ApiProperty({ description: "Derived urgency band: P1 (act now) … P4 (backlog)" }) urgency!: string;
  @ApiProperty() firstSeenAt!: Date;
}

export class SecurityEvaluationReportFindingsDto {
  @ApiProperty() open!: number;
  @ApiProperty({ type: Object, description: "Open findings counted per severity" })
  bySeverity!: Record<string, number>;
  @ApiProperty({ type: Object, description: "Open findings counted per urgency band" })
  byUrgency!: Record<string, number>;
  @ApiProperty({ type: [SecurityEvaluationReportTopFindingDto], isArray: true })
  topOpen!: SecurityEvaluationReportTopFindingDto[];
}

export class SecurityEvaluationReportTrendPointDto {
  @ApiProperty() weekStart!: Date;
  @ApiProperty() opened!: number;
  @ApiProperty() resolved!: number;
}

export class SecurityEvaluationReportMttrDto {
  @ApiPropertyOptional({ description: "Mean days to resolve, null while nothing has been resolved" })
  averageDays?: number | null;
  @ApiProperty() resolvedCount!: number;
  @ApiProperty() windowDays!: number;
}

/** Single-axis report (ADR-022 D6): no composite score, no cross-family weighting. */
export class SecurityEvaluationReportResponseDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: SecurityEvaluationReportAssetsDto }) assets!: SecurityEvaluationReportAssetsDto;
  @ApiProperty({ type: SecurityEvaluationReportCoverageDto }) coverage!: SecurityEvaluationReportCoverageDto;
  @ApiProperty({ type: SecurityEvaluationReportFindingsDto }) findings!: SecurityEvaluationReportFindingsDto;
  @ApiProperty({ type: [SecurityEvaluationReportTrendPointDto], isArray: true })
  trend!: SecurityEvaluationReportTrendPointDto[];
  @ApiProperty({ type: SecurityEvaluationReportMttrDto }) mttr!: SecurityEvaluationReportMttrDto;
}
