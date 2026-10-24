import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { PeopleEvaluationPeriodStatus, PeopleEvaluationPeriodType } from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";

// --- Rubric versions ---------------------------------------------------

export class PeopleEvaluationDimensionDto {
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
    type: PeopleEvaluationDimensionDto,
    isArray: true,
    description: "Dimensions of this rubric version — the single source of truth for judgment",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PeopleEvaluationDimensionDto)
  dimensions!: PeopleEvaluationDimensionDto[];

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

export class PeopleEvaluationRubricVersionResponseDto {
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

  @ApiProperty({ enum: PeopleEvaluationPeriodType })
  @ValidateIf(() => true)
  @IsEnum(PeopleEvaluationPeriodType)
  type!: PeopleEvaluationPeriodType;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodStart!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodEnd!: Date;

  @ApiPropertyOptional({ enum: PeopleEvaluationPeriodStatus, description: "Initial status — defaults to UPCOMING" })
  @IsOptional()
  @IsEnum(PeopleEvaluationPeriodStatus)
  status?: PeopleEvaluationPeriodStatus;

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
  @ApiProperty({ enum: PeopleEvaluationPeriodStatus })
  @ValidateIf(() => true)
  @IsEnum(PeopleEvaluationPeriodStatus)
  status!: PeopleEvaluationPeriodStatus;
}

export class ListPeopleEvaluationPeriodsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ enum: PeopleEvaluationPeriodType, description: "Filter by period type" })
  @IsOptional()
  @IsEnum(PeopleEvaluationPeriodType)
  type?: PeopleEvaluationPeriodType;
}

export class PeopleEvaluationPeriodResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() rubricVersionId!: string;
  @ApiProperty() type!: PeopleEvaluationPeriodType;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty({ enum: PeopleEvaluationPeriodStatus }) status!: PeopleEvaluationPeriodStatus;
  @ApiPropertyOptional({ type: String, isArray: true }) collectionPeriodIds?: string[];
}

export class ListPeopleEvaluationPeriodsResponseDto extends CommonListResponseDto<PeopleEvaluationPeriodResponseDto> {}

// --- Home ground -------------------------------------------------------

export class UpdatePeopleEvaluationHomeGroundRequestDto {
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

// --- Reported evidence context -----------------------------------------

export class ListPeopleEvaluationWorkspacesRequestDto {
  @ApiProperty({ description: "Evaluatee whose reported workspaces are listed" })
  @IsUUID()
  evaluateeUserId!: string;
}

export class PeopleEvaluationWorkspaceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() rootPath!: string;
  @ApiPropertyOptional() installationId?: string | null;
  @ApiProperty() reportedAt!: Date;
}

export class ListPeopleEvaluationSessionsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Evaluatee whose collected sessions are listed" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiPropertyOptional({ description: "Restrict to one collection period" })
  @IsOptional()
  @IsUUID()
  collectionPeriodId?: string;
}

export class PeopleEvaluationSessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiPropertyOptional() collectionPeriodId?: string | null;
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

export class ListPeopleEvaluationSessionsResponseDto extends CommonListResponseDto<PeopleEvaluationSessionResponseDto> {}

export class ListPeopleEvaluationDeclaredDocumentsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Evaluatee whose declared documents are listed" })
  @IsUUID()
  evaluateeUserId!: string;
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

export class ListPeopleEvaluationDeclaredDocumentsResponseDto extends CommonListResponseDto<PeopleEvaluationDeclaredDocumentResponseDto> {}

// --- Home-ground read --------------------------------------------------

export class GetPeopleEvaluationHomeGroundRequestDto {
  @ApiProperty({ description: "Evaluatee whose home-ground declaration is read" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiProperty({ description: "Collection period of the declaration" })
  @IsUUID()
  collectionPeriodId!: string;
}

// --- Evaluation result manifest ----------------------------------------

export class PeopleEvaluationResultManifestResponseDto {
  @ApiProperty({ description: "SHA-256 over the canonical manifest" }) contentHash!: string;
  @ApiProperty({ type: Object, description: "Coverage statistics by layer and source" }) coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true, description: "Deterministic evidence manifest entries" })
  manifest!: object[];
}

// --- Evaluation results ------------------------------------------------

export class CreatePeopleEvaluationResultInput {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;
  @ApiProperty() @IsUUID() @IsNotEmpty() collectionPeriodId!: string;

  @ApiProperty({
    type: Object,
    isArray: true,
    description: "Deterministic evidence manifest entries the run was judged from",
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

export class UpdatePeopleEvaluationResultReviewRequestDto {
  @ApiPropertyOptional({ description: "Supervisor note visible to the member" })
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

export class ListPeopleEvaluationResultsRequestDto {
  @ApiProperty({ description: "Evaluatee whose results are listed" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiPropertyOptional({ description: "Restrict to one collection period" })
  @IsOptional()
  @IsUUID()
  collectionPeriodId?: string;
}

export class PeopleEvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() collectionPeriodId!: string;
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
  @ApiProperty({ type: Object, description: "Coverage declaration for this run" }) coverageStats!: object;
  @ApiPropertyOptional() reviewedByUserId?: string | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional() reviewNote?: string | null;
  @ApiProperty() createdAt!: Date;
}

// --- PIP plans ---------------------------------------------------------

export class CreatePeopleEvaluationPipPlanRequestDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() evaluateeUserId!: string;

  @ApiProperty({ type: String, isArray: true, description: "Evaluation result ids that triggered the plan" })
  @IsArray()
  @IsString({ each: true })
  triggerRefs!: string[];

  @ApiProperty() @Type(() => Date) @IsDate() startDate!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endDate!: Date;

  @ApiProperty({ type: Object, isArray: true, description: "[{ dueDate, description, status }]" })
  @IsArray()
  @IsObject({ each: true })
  checkpoints!: object[];
}

/** Values accepted for PeopleEvaluationPipPlan.result. */
export const PEOPLE_EVALUATION_PIP_DECISIONS = ["completed", "failed", "extended"] as const;
export type PeopleEvaluationPipDecision = (typeof PEOPLE_EVALUATION_PIP_DECISIONS)[number];

export class UpdatePeopleEvaluationPipPlanDecisionRequestDto {
  @ApiProperty({ enum: PEOPLE_EVALUATION_PIP_DECISIONS })
  @IsIn(PEOPLE_EVALUATION_PIP_DECISIONS)
  result!: string;

  @ApiPropertyOptional({ description: "Supervisor rationale visible to the member" })
  @IsOptional()
  @IsString()
  decisionNote?: string;
}

export class ListPeopleEvaluationPipPlansRequestDto {
  @ApiProperty({ description: "Evaluatee whose PIP plans are listed" })
  @IsUUID()
  evaluateeUserId!: string;
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

// --- Reported evidence ingest ------------------------------------------

/** Hard caps keep one ingest call bounded (evidence batches are small by design). */
export const MAX_WORKSPACES_PER_BATCH = 100;
export const MAX_SESSIONS_PER_BATCH = 50;
export const MAX_MESSAGES_PER_SESSION = 2000;
export const MAX_DOCUMENTS_PER_BATCH = 100;

/**
 * Transcript origins the installation agent knows how to read. "trae-memory" is
 * the IDE's own session summary (lower fidelity than a raw transcript) — the
 * distinction travels end to end so coverage can state it explicitly.
 */
export enum PeopleEvaluationSessionSource {
  CLAUDE = "claude",
  CODEX = "codex",
  TRAE_MEMORY = "trae-memory",
}

/**
 * Session ingest payload roles — the installation agent normalizes provider-specific
 * roles into this small set so the transcript stays tool-agnostic.
 */
export enum PeopleEvaluationMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  SYSTEM = "system",
}

export class PeopleEvaluationWorkspaceDto {
  @ApiProperty({ description: "IDE-side workspace identifier (stable across reports)" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty({ description: "Absolute workspace root path" })
  @IsString()
  @IsNotEmpty()
  rootPath!: string;
}

export class CreatePeopleEvaluationWorkspaceBatchRequestDto {
  @ApiProperty({ type: [PeopleEvaluationWorkspaceDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_WORKSPACES_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PeopleEvaluationWorkspaceDto)
  workspaces!: PeopleEvaluationWorkspaceDto[];
}

export class PeopleEvaluationSessionMessageDto {
  @ApiProperty({ description: "Monotonic sequence inside the session" })
  @IsNumber()
  seq!: number;

  @ApiProperty({
    description: 'Message role, e.g. "user" / "assistant" / "tool"',
    enum: PeopleEvaluationMessageRole,
    enumName: "PeopleEvaluationMessageRole",
  })
  @IsIn(Object.values(PeopleEvaluationMessageRole))
  role!: PeopleEvaluationMessageRole;

  @ApiProperty({ description: "Message content chunk (already redacted client-side)" })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ description: "Tool name when this message is a tool call/result" })
  @IsOptional()
  @IsString()
  toolName?: string;

  @ApiPropertyOptional({ description: "Raw JSON of tool calls in this message" })
  @IsOptional()
  @IsString()
  toolCalls?: string;

  @ApiPropertyOptional({ description: "Token count reported by the IDE, when known" })
  @IsOptional()
  @IsNumber()
  tokenCount?: number;

  @ApiPropertyOptional({ description: "Message timestamp — defaults to the session start" })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdAt?: Date;
}

export class PeopleEvaluationSessionDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalSessionId!: string;

  @ApiPropertyOptional({
    description: 'Transcript origin: "claude" / "codex" / "trae-memory" — defaults to "claude"',
    enum: PeopleEvaluationSessionSource,
    enumName: "PeopleEvaluationSessionSource",
  })
  @IsOptional()
  @IsEnum(PeopleEvaluationSessionSource)
  source?: PeopleEvaluationSessionSource;

  @ApiPropertyOptional() @IsOptional() @IsString() model?: string;
  @ApiProperty() @IsNumber() turnCount!: number;
  @ApiProperty() @IsNumber() messageCount!: number;
  @ApiProperty() @IsNumber() toolCallCount!: number;

  @ApiPropertyOptional({ type: [String], isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  toolNames?: string[];

  @ApiPropertyOptional({ type: [String], isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  touchedFiles?: string[];

  @ApiPropertyOptional() @IsOptional() @IsNumber() durationMs?: number;
  @ApiProperty() @Type(() => Date) @IsDate() startedAt!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endedAt!: Date;

  @ApiProperty({ type: [PeopleEvaluationSessionMessageDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGES_PER_SESSION)
  @ValidateNested({ each: true })
  @Type(() => PeopleEvaluationSessionMessageDto)
  messages!: PeopleEvaluationSessionMessageDto[];
}

export class CreatePeopleEvaluationSessionBatchRequestDto {
  @ApiProperty({ type: [PeopleEvaluationSessionDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_SESSIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PeopleEvaluationSessionDto)
  sessions!: PeopleEvaluationSessionDto[];
}

export class PeopleEvaluationDeclaredDocumentDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() title!: string;
  @ApiProperty({ description: "Workspace-relative path — stable identity of the document" })
  @IsString()
  @IsNotEmpty()
  refPath!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ description: "Document content, already redacted client-side" })
  @IsString()
  content!: string;
  @ApiProperty() @Type(() => Date) @IsDate() capturedAt!: Date;
}

export class CreatePeopleEvaluationDeclaredDocumentBatchRequestDto {
  @ApiProperty({ type: [PeopleEvaluationDeclaredDocumentDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PeopleEvaluationDeclaredDocumentDto)
  documents!: PeopleEvaluationDeclaredDocumentDto[];
}

/** Installation enrollment (supervisor-side; carries the evaluatee the token reports for). */
export class CreatePeopleEvaluationInstallationRequestDto {
  @ApiProperty({ description: 'Human-readable label, e.g. "worldzhy-macbook"' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({ description: "Evaluatee userId the token is allowed to report for" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiPropertyOptional({ description: "Host the installation agent runs on (informational)" })
  @IsOptional()
  @IsString()
  hostname?: string;
}

export class ListPeopleEvaluationInstallationsRequestDto {
  @ApiPropertyOptional({ description: "Filter by evaluatee userId" })
  @IsOptional()
  @IsUUID()
  evaluateeUserId?: string;
}

export class PeopleEvaluationInstallationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() label!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiPropertyOptional() hostname?: string | null;
  @ApiPropertyOptional() firstSeenAt?: Date | null;
  @ApiPropertyOptional() lastSeenAt?: Date | null;
  @ApiPropertyOptional() revokedAt?: Date | null;
  @ApiProperty() online!: boolean;
  @ApiProperty() createdAt!: Date;
}

/**
 * Installation credential returned exactly once, by creation or token rotation.
 * Installation rows only keep a hash, so this is the only time the plaintext
 * token is available; GET / List responses never carry it.
 */
export class PeopleEvaluationInstallationCredentialResponseDto extends PeopleEvaluationInstallationResponseDto {
  @ApiProperty({ description: "Plaintext token — shown once" })
  token!: string;
}
