import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { EvaluationFindingSeverity, EvaluationFindingStatus, EvaluationRunStatus } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

import {
  SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS,
  SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS_MAX,
} from "./security-evaluation.constants";

// --- Path params ---------------------------------------------------------

/** Path-parameter envelope for asset-scoped routes. */
export class GetSecurityEvaluationAssetRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  assetId!: string;
}

/** Path-parameter envelope for finding-scoped routes. */
export class GetSecurityEvaluationFindingRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  findingId!: string;
}

// --- Subject ingest ------------------------------------------------------

/**
 * One subject submission (ADR-039). The subject is platform-level — the caller
 * does NOT declare a scope; it only says where the material came from, through
 * the opaque `sourceType` / `sourceId` pair. Re-submitting the same subject and
 * source is idempotent; a new source adds a provenance row.
 */
export class IngestSecurityEvaluationSubjectRequestDto {
  @ApiProperty({ description: 'Subject kind, e.g. "repository" or "aws-account"' })
  @IsString()
  @IsNotEmpty()
  kind!: string;

  @ApiProperty({ description: "Stable identity of the subject in the deployment" })
  @IsString()
  @IsNotEmpty()
  subjectKey!: string;

  @ApiProperty({ description: "Human-readable name of the subject" })
  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @ApiPropertyOptional({ type: Object, description: "Opaque subject metadata forwarded to the run ports" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      "Opaque pointer to the host credentials this subject is evaluated with (required for aws-account); stored verbatim, never resolved by the module",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  credentialRef?: string;

  @ApiProperty({ description: 'Opaque provenance type, e.g. "project"' })
  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @ApiProperty({ description: "Opaque provenance id inside the source type" })
  @IsString()
  @IsNotEmpty()
  sourceId!: string;
}

export class IngestSecurityEvaluationSubjectResponseDto {
  @ApiProperty() subjectId!: string;
  @ApiProperty() assetId!: string;
}

// --- Assets --------------------------------------------------------------

export class ListSecurityEvaluationAssetsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({
    description:
      'Optional provenance filter: only assets submitted by this source type (e.g. "project"). Omit for the platform view.',
  })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({ description: "Optional provenance filter: only assets submitted by this source id" })
  @IsOptional()
  @IsString()
  scopeId?: string;
}

/** One provenance row of an asset (ADR-039). */
export class SecurityEvaluationAssetSourceResponseDto {
  @ApiProperty() sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiProperty() firstSubmittedAt!: Date;
  @ApiProperty() lastSubmittedAt!: Date;
}

/** Mirrors the SecurityEvaluationAsset row, decorated with the subject kind. */
export class SecurityEvaluationAssetResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ description: 'Subject kind behind this asset, e.g. "repository" or "aws-account"' }) kind!: string;
  @ApiProperty({ description: "Stable identity inside the scope: repository full name or AWS account id" })
  naturalKey!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() firstSeenAt!: Date;
  @ApiProperty({ description: "Last run that actually observed this asset's inventory" })
  lastSeenAt!: Date;
  @ApiProperty({
    type: [SecurityEvaluationAssetSourceResponseDto],
    isArray: true,
    description: "Who submitted this asset",
  })
  sources!: SecurityEvaluationAssetSourceResponseDto[];
}

export class ListSecurityEvaluationAssetsResponseDto extends CommonListResponseDto<SecurityEvaluationAssetResponseDto> {}

// --- Asset knowledge items -----------------------------------------------

export class ListSecurityEvaluationAssetKnowledgeItemsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: 'Restrict to one knowledge type, e.g. "npm.package"' })
  @IsOptional()
  @IsString()
  type?: string;
}

/** Mirrors one asset-scoped knowledge item row (AWS config or npm package). */
export class SecurityEvaluationAssetKnowledgeItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() assetId!: string;
  @ApiProperty({ description: 'Knowledge vocabulary type, e.g. "npm.package"' }) type!: string;
  @ApiProperty({ description: 'Knowledge identity, e.g. "npm:lodash@4.17.20"' }) key!: string;
  @ApiPropertyOptional({
    type: Object,
    description: "Small intrinsic values: version, isDev, ecosystem, region…",
  })
  value?: object | null;
  @ApiProperty({ description: "When this item was last observed" }) observedAt!: Date;
}

export class ListSecurityEvaluationAssetKnowledgeItemsResponseDto extends CommonListResponseDto<SecurityEvaluationAssetKnowledgeItemResponseDto> {}

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
  ruleSetVersionId?: string;

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
  @ApiPropertyOptional({
    description:
      "Optional provenance filter: only runs of assets submitted by this source type. Omit for the platform view.",
  })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({ description: "Optional provenance filter: only runs of assets submitted by this source id" })
  @IsOptional()
  @IsString()
  scopeId?: string;

  @ApiPropertyOptional({ description: "Restrict to one subject" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ description: "Restrict to one criteria version" })
  @IsOptional()
  @IsUUID()
  ruleSetVersionId?: string;

  @ApiPropertyOptional({ enum: EvaluationRunStatus, description: "Restrict to one run status, e.g. FAILED" })
  @IsOptional()
  @IsEnum(EvaluationRunStatus)
  status?: EvaluationRunStatus;
}

/** Mirrors the skeleton's EvaluationRun row, decorated with the evaluationKey labels. */
export class SecurityEvaluationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: 'Evaluation key of the run, e.g. "npm-osv"' }) evaluationKey!: string;
  @ApiProperty({ description: 'Criteria version label of the run, e.g. "v1"' }) ruleSetVersion!: string;
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
  ruleSetVersionId?: string;
}

/** Mirrors the skeleton's EvaluationResult read shape (manifest excluded). */
export class SecurityEvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: "SHA-256 over the archived manifest" }) contentHash!: string;
  @ApiProperty({ type: Object, description: "{ evaluated, declaredUnlinked, skipped } coverage buckets" })
  coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true, description: "Scored verdicts by criterionKey" })
  verdicts!: object[];
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional({ type: Object, description: "Judgment execution details" })
  metadata?: object | null;
  @ApiProperty() createdAt!: Date;
}

export class ListSecurityEvaluationResultsResponseDto extends CommonListResponseDto<SecurityEvaluationResultResponseDto> {}

// --- Findings ------------------------------------------------------------

export class ListSecurityEvaluationFindingsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({
    description:
      "Optional provenance filter: only findings of assets submitted by this source type. Omit for the platform view.",
  })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({
    description: "Optional provenance filter: only findings of assets submitted by this source id",
  })
  @IsOptional()
  @IsString()
  scopeId?: string;

  @ApiPropertyOptional({ description: "Restrict to one subject" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ description: "Restrict to findings last observed by this run" })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one criteria evaluationKey, e.g. "npm-osv"' })
  @IsOptional()
  @IsString()
  evaluationKey?: string;

  @ApiPropertyOptional({ enum: EvaluationFindingStatus })
  @IsOptional()
  @IsEnum(EvaluationFindingStatus)
  status?: EvaluationFindingStatus;

  @ApiPropertyOptional({ enum: EvaluationFindingSeverity })
  @IsOptional()
  @IsEnum(EvaluationFindingSeverity)
  severity?: EvaluationFindingSeverity;

  @ApiPropertyOptional({
    enum: ["P1", "P2", "P3", "P4"],
    description: "Urgency band stored in the finding's metadata (ADR-022 D5); equality filter",
  })
  @IsOptional()
  @IsIn(["P1", "P2", "P3", "P4"])
  urgency?: "P1" | "P2" | "P3" | "P4";

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'When "true", only OPEN findings not re-observed within the staleness window ' +
      "(the run that used to reproduce them stopped covering them without resolving them). " +
      "Implies status=OPEN unless status is given explicitly.",
  })
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  staleOnly?: boolean;
}

/** Mirrors the skeleton's EvaluationFinding row. */
export class SecurityEvaluationFindingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() evaluationKey!: string;
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

// --- Finding detail + evidence -------------------------------------------

/**
 * One matched manifest item: the exact shape EvaluationEvidenceItem archives
 * in EvaluationResult.manifest, returned verbatim so the client renders it.
 */
export class SecurityEvaluationEvidenceItemResponseDto {
  @ApiProperty({ description: "Stable id of this evidence item inside the manifest" })
  id!: string;
  @ApiProperty({ description: 'Collection layer: "declared" / "knowledge" / "source"' })
  layer!: string;
  @ApiProperty({ description: "Origin source the evidence came from (repository, threat-intel, config-api, …)" })
  source!: string;
  @ApiProperty({ description: "Human-readable summary — for source items this is the file path" })
  summary!: string;
  @ApiProperty({ type: Date })
  observedAt!: Date;
  @ApiPropertyOptional({ type: [String], description: "Cross-references the item carries (e.g. git revision)" })
  refs?: string[] | null;
  @ApiPropertyOptional({
    type: Object,
    description:
      "Feature-defined payload. CODE_SCAN items carry { path, language, bytes, revision, contentHash, excerpt, truncated }",
  })
  payload?: object | null;
}

/**
 * Single-finding read path: the finding row plus whichever manifest item of
 * its last-seen run matched (by file path for CODE_SCAN, by evidenceRefs for
 * other families). Returns evidenceItems = [] when the run had no matching
 * item (e.g. a finding carried no metadata.path or the run had no result).
 */
export class SecurityEvaluationFindingDetailResponseDto {
  @ApiProperty({ type: SecurityEvaluationFindingResponseDto })
  finding!: SecurityEvaluationFindingResponseDto;
  @ApiPropertyOptional({ description: "Rule set version label the last-seen run evaluated under" })
  ruleSetVersion?: string | null;
  @ApiPropertyOptional({ description: "Evaluated key of the last-seen run — echoes finding.evaluationKey" })
  evaluationKey?: string | null;
  @ApiProperty({
    type: [SecurityEvaluationEvidenceItemResponseDto],
    isArray: true,
    description: "Manifest items from the last-seen run's result that match the finding",
  })
  evidenceItems!: SecurityEvaluationEvidenceItemResponseDto[];
}

// --- Report --------------------------------------------------------------

export class GetSecurityEvaluationReportRequestDto {
  @ApiPropertyOptional({
    description:
      "Optional provenance filter: report only assets submitted by this source type. Omit for the platform view.",
  })
  @IsOptional()
  @IsString()
  scopeType?: string;

  @ApiPropertyOptional({ description: "Optional provenance filter: report only assets submitted by this source id" })
  @IsOptional()
  @IsString()
  scopeId?: string;

  @ApiPropertyOptional({
    description: "Window of the daily severity trend, in days (1…365). Defaults to 30.",
    default: SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS,
    minimum: 1,
    maximum: SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS_MAX)
  days?: number;
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
  @ApiProperty({ description: "Manifest material no rule of this evaluationKey consumed (ADR-037 D7)" })
  unconsumed!: number;
  @ApiProperty({ description: "Assets that have at least one archived result" }) assetsWithResult!: number;
  @ApiProperty({ description: "Assets whose subject kind requires a credential reference that is not registered" })
  unevaluable!: number;
}

export class SecurityEvaluationReportTopFindingDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity }) severity!: EvaluationFindingSeverity;
  @ApiProperty({ description: "Derived urgency band: P1 (act now) … P4 (backlog)" }) urgency!: string;
  @ApiProperty() firstSeenAt!: Date;
}

/** Open findings of one evaluationKey, split by severity. */
export class SecurityEvaluationReportFindingsByKeyDto {
  @ApiProperty({ description: 'Evaluation key, e.g. "npm-osv"' }) evaluationKey!: string;
  @ApiProperty() open!: number;
  @ApiProperty({ type: Object, description: "Open findings counted per severity" })
  bySeverity!: Record<string, number>;
}

export class SecurityEvaluationReportFindingsDto {
  @ApiProperty() open!: number;
  @ApiProperty({ type: Object, description: "Open findings counted per severity" })
  bySeverity!: Record<string, number>;
  @ApiProperty({ type: Object, description: "Open findings counted per urgency band" })
  byUrgency!: Record<string, number>;
  @ApiProperty({
    type: [SecurityEvaluationReportFindingsByKeyDto],
    isArray: true,
    description: "Open findings counted per evaluationKey and severity",
  })
  byEvaluationKey!: SecurityEvaluationReportFindingsByKeyDto[];
  @ApiProperty({ type: [SecurityEvaluationReportTopFindingDto], isArray: true })
  topOpen!: SecurityEvaluationReportTopFindingDto[];
}

/** One day of the severity trend: findings still open at the end of that day. */
export class SecurityEvaluationReportSeverityTrendPointDto {
  @ApiProperty() day!: Date;
  @ApiProperty({ type: Object, description: "Open findings counted per severity on that day" })
  bySeverity!: Record<string, number>;
  @ApiProperty() total!: number;
}

export class SecurityEvaluationReportSeverityTrendDto {
  @ApiProperty() windowDays!: number;
  @ApiProperty({ type: [SecurityEvaluationReportSeverityTrendPointDto], isArray: true })
  points!: SecurityEvaluationReportSeverityTrendPointDto[];
}

export class SecurityEvaluationReportTrendPointDto {
  @ApiProperty() weekStart!: Date;
  @ApiProperty() opened!: number;
  @ApiProperty() resolved!: number;
}

export class SecurityEvaluationReportMttrByKeyDto {
  @ApiProperty({ description: 'Evaluation key, e.g. "npm-osv"' }) evaluationKey!: string;
  @ApiPropertyOptional({ description: "Mean days to resolve inside the window" }) averageDays?: number | null;
  @ApiPropertyOptional({ description: "Median days to resolve inside the window" }) medianDays?: number | null;
  @ApiProperty() resolvedCount!: number;
}

export class SecurityEvaluationReportMttrDto {
  @ApiPropertyOptional({ description: "Mean days to resolve, null while nothing has been resolved" })
  averageDays?: number | null;
  @ApiProperty() resolvedCount!: number;
  @ApiProperty() windowDays!: number;
  @ApiProperty({
    type: [SecurityEvaluationReportMttrByKeyDto],
    isArray: true,
    description: "The same window split per evaluationKey",
  })
  byEvaluationKey!: SecurityEvaluationReportMttrByKeyDto[];
}

/** Single-axis report (ADR-022 D6): no composite score, no cross-evaluationKey weighting. */
export class SecurityEvaluationReportResponseDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: SecurityEvaluationReportAssetsDto }) assets!: SecurityEvaluationReportAssetsDto;
  @ApiProperty({ type: SecurityEvaluationReportCoverageDto }) coverage!: SecurityEvaluationReportCoverageDto;
  @ApiProperty({ type: SecurityEvaluationReportFindingsDto }) findings!: SecurityEvaluationReportFindingsDto;
  @ApiProperty({ type: [SecurityEvaluationReportTrendPointDto], isArray: true })
  trend!: SecurityEvaluationReportTrendPointDto[];
  @ApiProperty({ type: SecurityEvaluationReportSeverityTrendDto })
  severityTrend!: SecurityEvaluationReportSeverityTrendDto;
  @ApiProperty({ type: SecurityEvaluationReportMttrDto }) mttr!: SecurityEvaluationReportMttrDto;
}
