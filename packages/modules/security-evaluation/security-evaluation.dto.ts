import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { EvaluationFindingSeverity, EvaluationFindingStatus, EvaluationRunStatus } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

import {
  SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS,
  SECURITY_EVALUATION_REPORT_SEVERITY_TREND_DAYS_MAX,
} from "./security-evaluation.constants";

// --- Path params ---------------------------------------------------------

/** Path-parameter envelope for subject-scoped routes. */
export class GetSecurityEvaluationSubjectRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  subjectId!: string;
}

/** Path-parameter envelope for finding-scoped routes. */
export class GetSecurityEvaluationFindingRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  findingId!: string;
}

// --- Subject ingest ------------------------------------------------------

/**
 * Repository material of a repository subject (ADR-070 D1, D2). The coordinate
 * is vendor-neutral: `namespace` is the GitHub owner or Bitbucket workspace.
 * The module lowercases it and derives the subject key; `displayName` keeps the
 * original casing.
 */
export class IngestSecurityEvaluationRepositoryMaterialDto {
  @ApiProperty({ description: 'Code host provider, e.g. "github" or "bitbucket"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  provider!: string;

  @ApiProperty({ description: "First segment of the repository coordinate (owner / workspace)" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  namespace!: string;

  @ApiProperty({ description: "Repository name (last segment of the coordinate)" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: "Browsable repository URL, stored verbatim" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  url?: string;
}

/** AWS account material of an aws-account subject (ADR-070 D1, D2). */
export class IngestSecurityEvaluationAwsAccountMaterialDto {
  @ApiProperty({ description: "12-digit AWS account id — the natural key of the subject" })
  @IsString()
  @Matches(/^\d{12}$/, { message: "accountId must be 12 digits" })
  accountId!: string;

  @ApiPropertyOptional({ description: "Region collection default, e.g. us-east-1" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  defaultRegion?: string;

  @ApiPropertyOptional({ type: String, isArray: true, description: "Regions collected for this account" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];
}

/**
 * Web-origin material of a `web-origin` subject (ADR-066, ADR-072 D2). The
 * verification record itself is created by the module; a submission only decides
 * the path role → relative path map. Omitted `targetPaths` means `{}`.
 */
export class IngestSecurityEvaluationWebOriginMaterialDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
    description: "Path role → relative path (absolute on the origin).",
  })
  @IsOptional()
  @IsObject()
  targetPaths?: Record<string, string>;
}

/**
 * One subject submission (ADR-068 D8, ADR-070 D3, ADR-072 D2). The subject is
 * platform-level and identified by `(kind, subjectKey)` this feature owns;
 * provenance lives in the host, so no source is declared here.
 *
 * `POST /subjects` creates (409 on an existing subject); `POST /subjects/sync`
 * keeps the idempotent host-alignment semantics.
 *
 * Each kind carries its own material and the module derives the subject key from
 * it; `web-origin` supplies the key directly.
 */
export class IngestSecurityEvaluationSubjectRequestDto {
  @ApiProperty({ description: 'Subject kind, e.g. "repository" or "aws-account"' })
  @IsString()
  @IsNotEmpty()
  kind!: string;

  @ApiPropertyOptional({
    description:
      "Stable identity of the subject in the deployment. Derived from the material for repository / aws-account; required for other kinds.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subjectKey?: string;

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

  @ApiPropertyOptional({ type: IngestSecurityEvaluationRepositoryMaterialDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IngestSecurityEvaluationRepositoryMaterialDto)
  repository?: IngestSecurityEvaluationRepositoryMaterialDto;

  @ApiPropertyOptional({ type: IngestSecurityEvaluationAwsAccountMaterialDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IngestSecurityEvaluationAwsAccountMaterialDto)
  awsAccount?: IngestSecurityEvaluationAwsAccountMaterialDto;

  @ApiPropertyOptional({ type: IngestSecurityEvaluationWebOriginMaterialDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => IngestSecurityEvaluationWebOriginMaterialDto)
  webOrigin?: IngestSecurityEvaluationWebOriginMaterialDto;
}

export class IngestSecurityEvaluationSubjectResponseDto {
  @ApiProperty() subjectId!: string;
}

/** `PATCH /subjects/:subjectId` — only the mutable identity field (ADR-072 D3). */
export class UpdateSecurityEvaluationSubjectRequestDto {
  @ApiPropertyOptional({ description: "Human-readable name of the subject" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  displayName?: string;
}

/**
 * `PUT` / `PATCH /subjects/:subjectId/material` (ADR-072 D3). Only the mutable
 * material fields are accepted: a coordinate or account id is the subject
 * identity, so changing it would be another subject. The kind is decided by the
 * subject, not by the body — a field belonging to another kind is a 400.
 */
export class UpdateSecurityEvaluationSubjectMaterialRequestDto {
  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "string" },
    description: "web-origin: path role → relative path; PATCH merges by role, PUT replaces the map",
  })
  @IsOptional()
  @IsObject()
  targetPaths?: Record<string, string>;

  @ApiPropertyOptional({ type: String, nullable: true, description: "repository: browsable repository URL" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  url?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "aws-account: region collection default" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  defaultRegion?: string | null;

  @ApiPropertyOptional({ type: String, isArray: true, description: "aws-account: regions collected for this account" })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];
}

// --- Subject directory ---------------------------------------------------

/**
 * This feature's subject directory read; the asset inventory row is gone
 * (ADR-068 D7) and the owning feature key scopes the rows (ADR-069).
 */
export class ListSecurityEvaluationSubjectsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: 'Restrict to one subject kind, e.g. "repository"' })
  @IsOptional()
  @IsString()
  kind?: string;
}

/** Mirrors one stored subject row. */
export class SecurityEvaluationSubjectResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Owning feature key — always "security-evaluation" in this directory' })
  subjectType!: string;
  @ApiProperty({ description: 'Subject kind, e.g. "repository", "aws-account", "web-origin"' })
  kind!: string;
  @ApiProperty({ description: "Stable identity of the subject in the deployment" })
  subjectKey!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ type: Object, description: "Opaque host metadata stored on the subject" })
  metadata?: object | null;
  @ApiPropertyOptional({ type: String, description: "Opaque host credential pointer, if any" })
  credentialRef?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListSecurityEvaluationSubjectsResponseDto extends CommonListResponseDto<SecurityEvaluationSubjectResponseDto> {
  @ApiProperty({ type: SecurityEvaluationSubjectResponseDto, isArray: true })
  declare records: SecurityEvaluationSubjectResponseDto[];
}

// --- Knowledge items -----------------------------------------------------

export class ListSecurityEvaluationAssetKnowledgeItemsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: 'Restrict to one knowledge type, e.g. "npm.package"' })
  @IsOptional()
  @IsString()
  type?: string;
}

/** Mirrors one subject-scoped knowledge item row (AWS config or npm package). */
export class SecurityEvaluationAssetKnowledgeItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty({ description: 'Knowledge vocabulary type, e.g. "npm.package"' }) type!: string;
  @ApiProperty({ description: 'Knowledge identity, e.g. "npm:lodash@4.17.20"' }) key!: string;
  @ApiPropertyOptional({
    type: Object,
    description: "Small intrinsic values: version, isDev, ecosystem, region…",
  })
  value?: object | null;
  @ApiProperty({ description: "When this item was last observed" }) observedAt!: Date;
}

export class ListSecurityEvaluationAssetKnowledgeItemsResponseDto extends CommonListResponseDto<SecurityEvaluationAssetKnowledgeItemResponseDto> {
  @ApiProperty({ type: SecurityEvaluationAssetKnowledgeItemResponseDto, isArray: true })
  declare records: SecurityEvaluationAssetKnowledgeItemResponseDto[];
}

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

  @ApiPropertyOptional({ type: Object, description: "Opaque per-run judgment config (ADR-023, ADR-068)" })
  @IsOptional()
  @IsObject()
  judgmentConfig?: Record<string, unknown>;
}

/** Minimal acknowledgement of a fire-and-forget run trigger (HTTP 202). */
export class SecurityEvaluationRunAcceptedResponseDto {
  @ApiProperty({ description: "The run was dispatched; poll the run list for its row" })
  accepted!: boolean;
}

export class ListSecurityEvaluationRunsRequestDto extends CommonListRequestDto {
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

/** Mirrors the skeleton's EvaluationRun row, decorated with the standardKey labels. */
export class SecurityEvaluationRunResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: 'Evaluation key of the run, e.g. "npm-osv"' }) standardKey!: string;
  @ApiProperty({ description: 'Criteria version label of the run, e.g. "v1"' }) ruleSetVersion!: string;
  @ApiProperty({ enum: EvaluationRunStatus }) status!: EvaluationRunStatus;
  @ApiPropertyOptional({ type: String }) requestedBy?: string | null;
  @ApiPropertyOptional({ type: Object }) judgmentConfig?: object | null;
  @ApiPropertyOptional({ description: "Failure reason when status is FAILED", type: String })
  failureReason?: string | null;
  @ApiPropertyOptional({ type: Date }) startedAt?: Date | null;
  @ApiPropertyOptional({ type: Date }) finishedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListSecurityEvaluationRunsResponseDto extends CommonListResponseDto<SecurityEvaluationRunResponseDto> {
  @ApiProperty({ type: SecurityEvaluationRunResponseDto, isArray: true })
  declare records: SecurityEvaluationRunResponseDto[];
}

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

/** Mirrors the skeleton's EvaluationResult read shape (evidenceManifest excluded). */
export class SecurityEvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() ruleSetVersionId!: string;
  @ApiProperty({ description: "SHA-256 over the archived evidence manifest" }) manifestHash!: string;
  @ApiProperty({ type: Object, description: "{ evaluated, declaredUnlinked, skipped } coverage buckets" })
  coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true, description: "Scored verdicts by criterionKey" })
  verdicts!: object[];
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional({ type: Object, description: "Judgment execution details" })
  metadata?: object | null;
  @ApiProperty() createdAt!: Date;
}

export class ListSecurityEvaluationResultsResponseDto extends CommonListResponseDto<SecurityEvaluationResultResponseDto> {
  @ApiProperty({ type: SecurityEvaluationResultResponseDto, isArray: true })
  declare records: SecurityEvaluationResultResponseDto[];
}

// --- Findings ------------------------------------------------------------

export class ListSecurityEvaluationFindingsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: "Restrict to one subject" })
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @ApiPropertyOptional({ description: "Restrict to findings last observed by this run" })
  @IsOptional()
  @IsUUID()
  runId?: string;

  @ApiPropertyOptional({ description: 'Restrict to one criteria standardKey, e.g. "npm-osv"' })
  @IsOptional()
  @IsString()
  standardKey?: string;

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
  @ApiProperty() standardKey!: string;
  @ApiProperty() fingerprint!: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty({ enum: EvaluationFindingSeverity }) severity!: EvaluationFindingSeverity;
  @ApiProperty({ enum: EvaluationFindingStatus }) status!: EvaluationFindingStatus;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String }) description?: string | null;
  @ApiPropertyOptional({ type: Object }) metadata?: object | null;
  @ApiPropertyOptional({ type: String }) firstSeenRunId?: string | null;
  @ApiPropertyOptional({ type: String }) lastSeenRunId?: string | null;
  @ApiProperty() firstSeenAt!: Date;
  @ApiProperty() lastSeenAt!: Date;
  @ApiPropertyOptional({ type: Date }) resolvedAt?: Date | null;
  @ApiPropertyOptional({ type: String }) suppressionNote?: string | null;
  @ApiPropertyOptional({ type: Date }) suppressedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListSecurityEvaluationFindingsResponseDto extends CommonListResponseDto<SecurityEvaluationFindingResponseDto> {
  @ApiProperty({ type: SecurityEvaluationFindingResponseDto, isArray: true })
  declare records: SecurityEvaluationFindingResponseDto[];
}

// --- Finding detail + evidence -------------------------------------------

/**
 * One matched manifest item: the exact shape EvaluationEvidenceItem archives
 * in EvaluationResult.evidenceManifest, returned verbatim so the client renders it.
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
      "Feature-defined payload. CODE_SCAN items carry { path, language, bytes, revision, contentHash, truncated }; the source excerpt is stored outside the archived manifest and is attached as `excerpt` only while it is inside the retention window",
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
  @ApiPropertyOptional({ description: "Evaluated key of the last-seen run — echoes finding.standardKey" })
  standardKey?: string | null;
  @ApiProperty({
    type: SecurityEvaluationEvidenceItemResponseDto,
    isArray: true,
    description: "Manifest items from the last-seen run's result that match the finding",
  })
  evidenceItems!: SecurityEvaluationEvidenceItemResponseDto[];
}

// --- Report --------------------------------------------------------------

export class GetSecurityEvaluationReportRequestDto {
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
  @ApiProperty({ description: "Manifest material no rule of this standardKey consumed (ADR-037 D7)" })
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

/** Open findings of one standardKey, split by severity. */
export class SecurityEvaluationReportFindingsByKeyDto {
  @ApiProperty({ description: 'Evaluation key, e.g. "npm-osv"' }) standardKey!: string;
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
    type: SecurityEvaluationReportFindingsByKeyDto,
    isArray: true,
    description: "Open findings counted per standardKey and severity",
  })
  byStandardKey!: SecurityEvaluationReportFindingsByKeyDto[];
  @ApiProperty({ type: SecurityEvaluationReportTopFindingDto, isArray: true })
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
  @ApiProperty({ type: SecurityEvaluationReportSeverityTrendPointDto, isArray: true })
  points!: SecurityEvaluationReportSeverityTrendPointDto[];
}

export class SecurityEvaluationReportTrendPointDto {
  @ApiProperty() weekStart!: Date;
  @ApiProperty() opened!: number;
  @ApiProperty() resolved!: number;
}

export class SecurityEvaluationReportMttrByKeyDto {
  @ApiProperty({ description: 'Evaluation key, e.g. "npm-osv"' }) standardKey!: string;
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
    type: SecurityEvaluationReportMttrByKeyDto,
    isArray: true,
    description: "The same window split per standardKey",
  })
  byStandardKey!: SecurityEvaluationReportMttrByKeyDto[];
}

/** Single-axis report (ADR-022 D6): no composite score, no cross-standardKey weighting. */
export class SecurityEvaluationReportResponseDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: SecurityEvaluationReportAssetsDto }) assets!: SecurityEvaluationReportAssetsDto;
  @ApiProperty({ type: SecurityEvaluationReportCoverageDto }) coverage!: SecurityEvaluationReportCoverageDto;
  @ApiProperty({ type: SecurityEvaluationReportFindingsDto }) findings!: SecurityEvaluationReportFindingsDto;
  @ApiProperty({ type: SecurityEvaluationReportTrendPointDto, isArray: true })
  trend!: SecurityEvaluationReportTrendPointDto[];
  @ApiProperty({ type: SecurityEvaluationReportSeverityTrendDto })
  severityTrend!: SecurityEvaluationReportSeverityTrendDto;
  @ApiProperty({ type: SecurityEvaluationReportMttrDto }) mttr!: SecurityEvaluationReportMttrDto;
}
