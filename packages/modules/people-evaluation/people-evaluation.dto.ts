import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PeriodStatus, PeriodType } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

// --- Rubric versions ---------------------------------------------------

export class CreatePeopleEvaluationDimensionRequestDto {
  @ApiProperty({ description: 'Unique dimension key inside the rubric, e.g. "ai-collaboration"' })
  @IsString()
  @IsNotEmpty()
  dimensionKey!: string;

  @ApiProperty({ description: "Human-readable dimension name" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: "Lower anchor of the expected band" })
  @IsOptional()
  @IsNumber()
  anchorLow?: number;

  @ApiPropertyOptional({ description: "Upper anchor of the expected band" })
  @IsOptional()
  @IsNumber()
  anchorHigh?: number;

  @ApiPropertyOptional({ description: "Full-load reference baseline, published ex ante" })
  @IsOptional()
  @IsString()
  fullLoadBaseRef?: string;

  @ApiPropertyOptional({ description: "Dimension description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: Object,
    isArray: true,
    description: 'Calibration examples: [{ level, kind: "positive"|"negative", example, rationale }]',
  })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  calibrationExamples?: object[];
}

export class CreatePeopleEvaluationRubricVersionRequestDto {
  @ApiProperty({ description: 'Semantic version string, e.g. "v0.1"' })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiProperty({
    type: CreatePeopleEvaluationDimensionRequestDto,
    isArray: true,
    description: "Dimensions of this rubric version — the single source of truth for judgment",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePeopleEvaluationDimensionRequestDto)
  dimensions!: CreatePeopleEvaluationDimensionRequestDto[];

  @ApiPropertyOptional({ description: "Floor rule thresholds JSON — reported as risks, never applied mechanically" })
  @IsOptional()
  @IsObject()
  floorRules?: object;

  @ApiProperty({ description: "Company direction statement — anchor text for every qualitative judgment" })
  @IsString()
  @IsNotEmpty()
  companyDirectionStatement!: string;

  @ApiPropertyOptional({ description: "Override rubric publish time — defaults to now" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date;

  @ApiPropertyOptional({ description: "Whether this version is active immediately — defaults to true" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PeopleEvaluationDimensionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() dimensionKey!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() anchorLow?: number | null;
  @ApiPropertyOptional() anchorHigh?: number | null;
  @ApiPropertyOptional() fullLoadBaseRef?: string | null;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional({ type: [Object] }) calibrationExamples?: object[] | null;
}

export class CreatePeopleEvaluationRubricVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() version!: string;
  @ApiProperty() publishedAt!: Date;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() companyDirectionStatement!: string;
  @ApiPropertyOptional({ type: PeopleEvaluationDimensionResponseDto, isArray: true })
  dimensions?: PeopleEvaluationDimensionResponseDto[];
  @ApiProperty() createdAt!: Date;
}

// --- Evaluation periods ------------------------------------------------

export class CreatePeopleEvaluationPeriodRequestDto {
  @ApiProperty({ description: "Rubric version this period is judged against" })
  @IsUUID()
  @IsNotEmpty()
  rubricVersionId!: string;

  @ApiProperty({ enum: PeriodType })
  @ValidateIf(() => true)
  @IsEnum(PeriodType)
  type!: PeriodType;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodStart!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodEnd!: Date;

  @ApiPropertyOptional({ enum: PeriodStatus, description: "Initial status — defaults to UPCOMING" })
  @IsOptional()
  @IsEnum(PeriodStatus)
  status?: PeriodStatus;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description: "COLLECTION period ids rolled up by this REVIEW period",
  })
  @IsOptional()
  @IsArray()
  @IsUUID("4", { each: true })
  collectionPeriodIds?: string[];
}

export class UpdatePeopleEvaluationPeriodStatusRequestDto {
  @ApiProperty({ enum: PeriodStatus })
  @ValidateIf(() => true)
  @IsEnum(PeriodStatus)
  status!: PeriodStatus;
}

export class ListPeopleEvaluationPeriodsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ enum: PeriodType, description: "Filter by period type" })
  @IsOptional()
  @IsEnum(PeriodType)
  type?: PeriodType;
}

export class CreatePeopleEvaluationPeriodResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() type!: PeriodType;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty({ enum: PeriodStatus }) status!: PeriodStatus;
  @ApiPropertyOptional({ type: String, isArray: true }) collectionPeriodIds?: string[];
}

export class ListPeopleEvaluationPeriodsResponseDto extends CommonListResponseDto<CreatePeopleEvaluationPeriodResponseDto> {}

// --- Home ground -------------------------------------------------------

export class DeclarePeopleEvaluationHomeGroundRequestDto {
  @ApiProperty({ description: "Who declares the specialty circle (evaluatee userId)" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  collectionPeriodId!: string;

  @ApiProperty({ type: String, isArray: true, description: "dimensionKey[] of the specialty circle" })
  @IsArray()
  @IsString({ each: true })
  homeDimensions!: string[];
}

export class PeopleEvaluationHomeGroundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() collectionPeriodId!: string;
  @ApiProperty({ type: String, isArray: true }) homeDimensions!: string[];
  @ApiProperty() declaredAt!: Date;
}

// --- Collector reports -------------------------------------------------

export class ReportPeopleEvaluationWorkspaceRequestDto {
  @ApiProperty({ description: "Member the workspace belongs to" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty({ description: "IDE-side workspace identifier (stable across reports)" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty({ description: "Absolute workspace root path" })
  @IsString()
  @IsNotEmpty()
  rootPath!: string;

  @ApiProperty({ description: "Self-declared company/personal split" })
  @IsBoolean()
  isCompany!: boolean;

  @ApiProperty({
    type: Object,
    isArray: true,
    description: "Workspace → repository mapping: [{ path, platform, repositoryFullName }]",
  })
  @IsArray()
  @IsObject({ each: true })
  repositories!: object[];
}

export class ReportPeopleEvaluationSessionRequestDto {
  @ApiProperty({ description: "Member the session belongs to" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty({ description: "Workspace the session ran in" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty({ description: "Collector-side stable session id" })
  @IsString()
  @IsNotEmpty()
  externalSessionId!: string;

  @ApiPropertyOptional({ description: "Model identifier used in the session" })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty() @IsNumber() turnCount!: number;
  @ApiProperty() @IsNumber() messageCount!: number;
  @ApiProperty() @IsNumber() toolCallCount!: number;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolNames?: string[];

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  touchedFiles?: string[];

  @ApiPropertyOptional() @IsOptional() @IsNumber() durationMs?: number;

  @ApiProperty() @Type(() => Date) @IsDate() startedAt!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endedAt!: Date;
}

export class ReportPeopleEvaluationDocumentRequestDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;

  @ApiProperty({ description: "Workspace the document was captured from" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty() @IsString() @IsNotEmpty() title!: string;

  @ApiProperty({ description: "Workspace-relative path — the stable identity of the document" })
  @IsString()
  @IsNotEmpty()
  refPath!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;

  @ApiProperty({ description: "Document content, already redacted client-side" })
  @IsString()
  content!: string;

  @ApiProperty() @Type(() => Date) @IsDate() capturedAt!: Date;
}

export class PeopleEvaluationMemberWorkspaceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() rootPath!: string;
  @ApiProperty() isCompany!: boolean;
  @ApiProperty({ type: Object, isArray: true }) repositories!: object[];
  @ApiPropertyOptional() installationId?: string | null;
  @ApiProperty() reportedAt!: Date;
}

export class PeopleEvaluationAgentSessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiPropertyOptional() collectionPeriodId?: string | null;
  @ApiPropertyOptional() memberWorkspaceId?: string | null;
  @ApiProperty() externalSessionId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() model!: string;
  @ApiProperty() turnCount!: number;
  @ApiProperty() messageCount!: number;
  @ApiProperty() toolCallCount!: number;
  @ApiPropertyOptional({ type: [String] }) toolNames?: string[] | null;
  @ApiPropertyOptional({ type: [String] }) touchedFiles?: string[] | null;
  @ApiPropertyOptional() durationMs?: number | null;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() endedAt!: Date;
}

export class PeopleEvaluationDeclaredDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() title!: string;
  @ApiProperty() refPath!: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() capturedAt!: Date;
  @ApiProperty() createdAt!: Date;
}

// --- Evidence packets --------------------------------------------------

export class UpsertPeopleEvaluationPacketRequestDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() collectionPeriodId!: string;

  @ApiProperty({
    type: Object,
    isArray: true,
    description: "Deterministic evidence manifest entries",
  })
  @IsArray()
  @IsObject({ each: true })
  manifest!: object[];

  @ApiProperty({ description: "SHA-256 over the canonical manifest" })
  @IsString()
  @IsNotEmpty()
  contentHash!: string;

  @ApiProperty({ description: "Coverage statistics by layer and source" })
  @IsObject()
  @IsNotEmpty()
  coverageStats!: object;
}

export class PeopleEvaluationEvidencePacketResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() collectionPeriodId!: string;
  @ApiProperty({ type: Object, isArray: true }) manifest!: object[];
  @ApiProperty() contentHash!: string;
  @ApiProperty() coverageStats!: object;
  @ApiProperty() generatedAt!: Date;
}

// --- Assessments -------------------------------------------------------

export class CreatePeopleEvaluationAssessmentRequestDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() collectionPeriodId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() packetId!: string;

  @ApiProperty({ description: "Blind subject id the model saw instead of the real identity" })
  @IsString()
  @IsNotEmpty()
  blindSubjectId!: string;

  @ApiProperty() @IsString() @IsNotEmpty() promptVersion!: string;
  @ApiProperty() @IsString() @IsNotEmpty() model!: string;

  @ApiProperty({
    type: Object,
    isArray: true,
    description:
      "Per-dimension judgments: [{ dimensionKey, score, confidence, coverage, evidenceRefs, rationale, unresolved? }]",
  })
  @IsArray()
  @IsObject({ each: true })
  dimensionScores!: object[];

  @ApiProperty({ description: "Overall judgment text — no composite score is produced" })
  @IsString()
  @IsNotEmpty()
  overallText!: string;

  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  highlights?: object[];
  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  risks?: object[];
  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  unresolved?: object[];
  @ApiPropertyOptional({ type: Object, isArray: true })
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  skipped?: object[];
  @ApiPropertyOptional({ description: "Dual-model disagreement list, when the mode is enabled" })
  @IsOptional()
  @IsObject()
  disagreement?: object;
}

export class ReviewPeopleEvaluationAssessmentRequestDto {
  @ApiProperty({ description: "Supervisor userId recording the final call" })
  @IsUUID()
  @IsNotEmpty()
  reviewedByUserId!: string;

  @ApiPropertyOptional({ description: "Supervisor note visible to the member" })
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

export class PeopleEvaluationAssessmentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() collectionPeriodId!: string;
  @ApiProperty() packetId!: string;
  @ApiProperty() blindSubjectId!: string;
  @ApiProperty() promptVersion!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ type: Object, isArray: true }) dimensionScores!: object[];
  @ApiProperty() overallText!: string;
  @ApiPropertyOptional({ type: [Object] }) highlights?: object[] | null;
  @ApiPropertyOptional({ type: [Object] }) risks?: object[] | null;
  @ApiPropertyOptional({ type: [Object] }) unresolved?: object[] | null;
  @ApiPropertyOptional({ type: [Object] }) skipped?: object[] | null;
  @ApiPropertyOptional() disagreement?: object | null;
  @ApiPropertyOptional() reviewedByUserId?: string | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional() reviewNote?: string | null;
  @ApiProperty() createdAt!: Date;
}

// --- PIP plans ---------------------------------------------------------

export class CreatePeopleEvaluationPipPlanRequestDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;

  @ApiProperty({ type: String, isArray: true, description: "Assessment / risk ids that triggered the plan" })
  @IsArray()
  @IsString({ each: true })
  triggerRefs!: string[];

  @ApiProperty() @Type(() => Date) @IsDate() startDate!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endDate!: Date;

  @ApiProperty({ type: Object, isArray: true, description: "[{ dueDate, description, status }]" })
  @IsArray()
  @IsObject({ each: true })
  checkpoints!: object[];

  @ApiPropertyOptional() @IsOptional() @IsString() decisionNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() decidedByUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() result?: string;
}

export class PeopleEvaluationPipPlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty({ type: String, isArray: true }) triggerRefs!: string[];
  @ApiProperty() startDate!: Date;
  @ApiProperty() endDate!: Date;
  @ApiProperty({ type: Object, isArray: true }) checkpoints!: object[];
  @ApiPropertyOptional() result?: string | null;
  @ApiPropertyOptional() decisionNote?: string | null;
  @ApiPropertyOptional() decidedByUserId?: string | null;
  @ApiPropertyOptional() decidedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
}
