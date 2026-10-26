import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
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
  ValidateNested,
} from "class-validator";
import {
  EvaluationCriterionKind,
  EvaluationRunStatus,
  WorkEvaluationPeriodStatus,
  WorkEvaluationPeriodType,
} from "@generated/prisma/client";
import { CommonListRequestDto, CommonListResponseDto } from "@devbie/newbie/common.dto";
import { BooleanTransformer } from "@devbie/newbie/transformers/boolean.transformer";

// --- Path params ---------------------------------------------------------

/** Path-parameter envelope for every work-evaluation `:id` route — all ids are UUIDs. */
export class GetWorkEvaluationByIdRequestDto {
  @ApiProperty({ type: String, format: "uuid" })
  @IsUUID()
  id!: string;
}

// --- Criteria versions (skeleton administration, pinned to kind "work") ---

/**
 * Structured feature metadata of a criteria version (spec §5): the floor rules
 * and the company direction statement the judgment prompt anchors on.
 */
export class WorkEvaluationCriteriaVersionMetadataDto {
  @ApiPropertyOptional({ description: "Floor rule thresholds JSON — reported as risks, never applied mechanically" })
  @IsOptional()
  @IsObject()
  floorRules?: object;

  @ApiPropertyOptional({ description: "Company direction statement — anchor text for every qualitative judgment" })
  @IsOptional()
  @IsString()
  companyDirectionStatement?: string;
}

/** Structured feature metadata of one criterion: anchors and calibration examples. */
export class WorkEvaluationCriterionMetadataDto {
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

export class CreateWorkEvaluationCriteriaVersionRequestDto {
  @ApiProperty({ description: 'Feature-defined criteria evaluationKey, e.g. "rubric"' })
  @IsString()
  @IsNotEmpty()
  evaluationKey!: string;

  @ApiProperty({ description: 'Semantic version string, e.g. "v0.1"' })
  @IsString()
  @IsNotEmpty()
  version!: string;

  @ApiPropertyOptional({ description: "Version description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: WorkEvaluationCriteriaVersionMetadataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkEvaluationCriteriaVersionMetadataDto)
  metadata?: WorkEvaluationCriteriaVersionMetadataDto;
}

export class ListWorkEvaluationCriteriaVersionsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ description: "Filter by criteria evaluationKey" })
  @IsOptional()
  @IsString()
  evaluationKey?: string;

  @ApiPropertyOptional({ description: "Include draft (unpublished) versions — defaults to published only" })
  @IsOptional()
  @IsBoolean()
  @Transform(BooleanTransformer)
  includeDrafts?: boolean;
}

export class CreateWorkEvaluationCriterionRequestDto {
  @ApiProperty({ description: 'Unique criterion key inside the version, e.g. "ai-collaboration"' })
  @IsString()
  @IsNotEmpty()
  criterionKey!: string;

  @ApiProperty({
    description: 'Criterion kind: "SCORED" produces a verdict, "ASSERTION" produces a finding',
    enum: EvaluationCriterionKind,
    enumName: "EvaluationCriterionKind",
  })
  @IsEnum(EvaluationCriterionKind)
  kind!: EvaluationCriterionKind;

  @ApiProperty({ description: "Human-readable criterion name" })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: "Criterion description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: WorkEvaluationCriterionMetadataDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorkEvaluationCriterionMetadataDto)
  metadata?: WorkEvaluationCriterionMetadataDto;
}

export class WorkEvaluationCriteriaVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() evaluationKey!: string;
  @ApiProperty() version!: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional({ type: WorkEvaluationCriteriaVersionMetadataDto })
  metadata?: WorkEvaluationCriteriaVersionMetadataDto | null;
  @ApiPropertyOptional({ description: "Null while the version is a draft", type: Date })
  publishedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class ListWorkEvaluationCriteriaVersionsResponseDto extends CommonListResponseDto<WorkEvaluationCriteriaVersionResponseDto> {}

export class WorkEvaluationCriterionResponseDto {
  @ApiPropertyOptional({ description: "Row id — present on freshly created criteria" })
  id?: string;
  @ApiProperty() criterionKey!: string;
  @ApiProperty({ enum: EvaluationCriterionKind, enumName: "EvaluationCriterionKind" })
  kind!: EvaluationCriterionKind;
  @ApiProperty() name!: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional({ type: WorkEvaluationCriterionMetadataDto })
  metadata?: WorkEvaluationCriterionMetadataDto | null;
}

// --- Evaluation periods ------------------------------------------------

export class CreateWorkEvaluationPeriodRequestDto {
  @ApiProperty({ description: 'Published criteria version (kind "work") this period is judged against' })
  @IsUUID()
  @IsNotEmpty()
  criteriaVersionId!: string;

  @ApiProperty({ type: String, enum: WorkEvaluationPeriodType })
  @IsEnum(WorkEvaluationPeriodType)
  type!: WorkEvaluationPeriodType;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodStart!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  periodEnd!: Date;
}

export class UpdateWorkEvaluationPeriodStatusRequestDto {
  @ApiProperty({ type: String, enum: WorkEvaluationPeriodStatus })
  @IsEnum(WorkEvaluationPeriodStatus)
  status!: WorkEvaluationPeriodStatus;
}

export class ListWorkEvaluationPeriodsRequestDto extends CommonListRequestDto {
  @ApiPropertyOptional({ enum: WorkEvaluationPeriodType, description: "Filter by period type" })
  @IsOptional()
  @IsEnum(WorkEvaluationPeriodType)
  type?: WorkEvaluationPeriodType;
}

export class WorkEvaluationPeriodResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() criteriaVersionId!: string;
  @ApiProperty() type!: WorkEvaluationPeriodType;
  @ApiProperty() periodStart!: Date;
  @ApiProperty() periodEnd!: Date;
  @ApiProperty({ enum: WorkEvaluationPeriodStatus }) status!: WorkEvaluationPeriodStatus;
}

export class ListWorkEvaluationPeriodsResponseDto extends CommonListResponseDto<WorkEvaluationPeriodResponseDto> {}

// --- Home ground -------------------------------------------------------

export class UpdateWorkEvaluationHomeGroundRequestDto {
  @ApiProperty({ description: "Who declares the specialty circle (evaluatee userId)" })
  @IsUUID()
  @IsNotEmpty()
  evaluateeUserId!: string;

  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  collectionPeriodId!: string;

  @ApiProperty({ type: String, isArray: true, description: "criterionKey[] of the specialty circle" })
  @IsArray()
  @IsString({ each: true })
  homeCriteria!: string[];
}

export class WorkEvaluationHomeGroundResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() collectionPeriodId!: string;
  @ApiProperty({ type: String, isArray: true }) homeCriteria!: string[];
  @ApiProperty() declaredAt!: Date;
}

// --- Home-ground read --------------------------------------------------

export class GetWorkEvaluationHomeGroundRequestDto {
  @ApiProperty({ description: "Evaluatee whose home-ground declaration is read" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiProperty({ description: "Collection period of the declaration" })
  @IsUUID()
  collectionPeriodId!: string;
}

// --- Reported evidence reads --------------------------------------------

export class ListWorkEvaluationWorkspacesRequestDto {
  @ApiProperty({ description: "Evaluatee whose reported workspaces are listed" })
  @IsUUID()
  evaluateeUserId!: string;
}

export class WorkEvaluationWorkspaceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() rootPath!: string;
  @ApiPropertyOptional() installationId?: string | null;
  @ApiProperty() reportedAt!: Date;
}

export class ListWorkEvaluationSessionsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Evaluatee whose collected sessions are listed" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiPropertyOptional({ description: "Restrict to one collection period" })
  @IsOptional()
  @IsUUID()
  collectionPeriodId?: string;
}

export class WorkEvaluationSessionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiPropertyOptional() collectionPeriodId?: string | null;
  @ApiProperty() externalSessionId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() model!: string;
  @ApiProperty({ description: 'Transcript origin: "claude" / "codex" / "trae-memory"' }) source!: string;
  @ApiProperty() turnCount!: number;
  @ApiProperty() messageCount!: number;
  @ApiProperty() toolCallCount!: number;
  @ApiPropertyOptional({ type: [String] }) toolNames?: string[] | null;
  @ApiPropertyOptional({ type: [String] }) touchedFiles?: string[] | null;
  @ApiPropertyOptional() durationMs?: number | null;
  @ApiProperty() startedAt!: Date;
  @ApiProperty() endedAt!: Date;
}

export class ListWorkEvaluationSessionsResponseDto extends CommonListResponseDto<WorkEvaluationSessionResponseDto> {}

export class ListWorkEvaluationDeclaredDocumentsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Evaluatee whose declared documents are listed" })
  @IsUUID()
  evaluateeUserId!: string;
}

export class WorkEvaluationDeclaredDocumentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() evaluateeUserId!: string;
  @ApiProperty() workspaceKey!: string;
  @ApiProperty() title!: string;
  @ApiProperty() refPath!: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional({
    description:
      "Document content — present only on the single-document read (GET /work-evaluation/evidence/documents/:id)",
  })
  content?: string;
  @ApiProperty() capturedAt!: Date;
  @ApiProperty() createdAt!: Date;
}

export class ListWorkEvaluationDeclaredDocumentsResponseDto extends CommonListResponseDto<WorkEvaluationDeclaredDocumentResponseDto> {}

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
export enum WorkEvaluationSessionSource {
  CLAUDE = "claude",
  CODEX = "codex",
  TRAE_MEMORY = "trae-memory",
}

/**
 * Session ingest payload roles — the installation agent normalizes provider-specific
 * roles into this small set so the transcript stays tool-agnostic.
 */
export enum WorkEvaluationMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  TOOL = "tool",
  SYSTEM = "system",
}

export class WorkEvaluationWorkspaceDto {
  @ApiProperty({ description: "IDE-side workspace identifier (stable across reports)" })
  @IsString()
  @IsNotEmpty()
  workspaceKey!: string;

  @ApiProperty({ description: "Absolute workspace root path" })
  @IsString()
  @IsNotEmpty()
  rootPath!: string;
}

export class CreateWorkEvaluationWorkspaceBatchRequestDto {
  @ApiProperty({ type: [WorkEvaluationWorkspaceDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_WORKSPACES_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorkEvaluationWorkspaceDto)
  workspaces!: WorkEvaluationWorkspaceDto[];
}

export class WorkEvaluationSessionMessageDto {
  @ApiProperty({ description: "Monotonic sequence inside the session" })
  @IsNumber()
  seq!: number;

  @ApiProperty({
    description: 'Message role, e.g. "user" / "assistant" / "tool"',
    enum: WorkEvaluationMessageRole,
    enumName: "WorkEvaluationMessageRole",
  })
  @IsIn(Object.values(WorkEvaluationMessageRole))
  role!: WorkEvaluationMessageRole;

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

export class WorkEvaluationSessionDto {
  @ApiProperty() @IsString() @IsNotEmpty() workspaceKey!: string;
  @ApiProperty() @IsString() @IsNotEmpty() externalSessionId!: string;

  @ApiPropertyOptional({
    description: 'Transcript origin: "claude" / "codex" / "trae-memory" — defaults to "claude"',
    enum: WorkEvaluationSessionSource,
    enumName: "WorkEvaluationSessionSource",
  })
  @IsOptional()
  @IsEnum(WorkEvaluationSessionSource)
  source?: WorkEvaluationSessionSource;

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

  @ApiProperty({ type: [WorkEvaluationSessionMessageDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGES_PER_SESSION)
  @ValidateNested({ each: true })
  @Type(() => WorkEvaluationSessionMessageDto)
  messages!: WorkEvaluationSessionMessageDto[];
}

export class CreateWorkEvaluationSessionBatchRequestDto {
  @ApiProperty({ type: [WorkEvaluationSessionDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_SESSIONS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorkEvaluationSessionDto)
  sessions!: WorkEvaluationSessionDto[];
}

export class WorkEvaluationDeclaredDocumentDto {
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

export class CreateWorkEvaluationDeclaredDocumentBatchRequestDto {
  @ApiProperty({ type: [WorkEvaluationDeclaredDocumentDto], isArray: true })
  @IsArray()
  @ArrayMaxSize(MAX_DOCUMENTS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => WorkEvaluationDeclaredDocumentDto)
  documents!: WorkEvaluationDeclaredDocumentDto[];
}

// --- Installations -------------------------------------------------------

/** Installation enrollment (supervisor-side; carries the evaluatee the token reports for). */
export class CreateWorkEvaluationInstallationRequestDto {
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

export class ListWorkEvaluationInstallationsRequestDto {
  @ApiPropertyOptional({ description: "Filter by evaluatee userId" })
  @IsOptional()
  @IsUUID()
  evaluateeUserId?: string;
}

export class WorkEvaluationInstallationResponseDto {
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
export class WorkEvaluationInstallationCredentialResponseDto extends WorkEvaluationInstallationResponseDto {
  @ApiProperty({ description: "Plaintext token — shown once" })
  token!: string;
}

// --- Evaluation runs, results and subjects (skeleton shapes) -------------

/**
 * Request to open an on-demand evaluation run (ADR-023/ADR-026, spec §4.4).
 * The caller names the member and the period; the subject row is registered
 * lazily and the period travels on the run's config. The trigger is
 * fire-and-forget: the skeleton runner owns the whole run lifecycle
 * synchronously, so the response is a bare acknowledgement and the caller
 * discovers the run through `GET /work-evaluation/runs?subjectId=`.
 */
export class StartWorkEvaluationRunRequestDto {
  @ApiProperty({ description: "Member (user id) to evaluate; the work subject is registered lazily" })
  @IsUUID()
  evaluateeUserId!: string;

  @ApiProperty({ description: "COLLECTION period that has started; pins the criteria version and the evidence window" })
  @IsUUID()
  periodId!: string;

  @ApiPropertyOptional({
    type: Object,
    description: "Opaque per-run config (ADR-023), e.g. { modelScope } for multi-model runs",
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

/** Minimal acknowledgement of a fire-and-forget run trigger (HTTP 202). */
export class WorkEvaluationRunAcceptedResponseDto {
  @ApiProperty({ description: "The run was dispatched; poll the run list for its row" })
  accepted!: boolean;
}

export class ListWorkEvaluationRunsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose runs are listed (newest first)" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: "Restrict to one criteria version" })
  @IsOptional()
  @IsUUID()
  criteriaVersionId?: string;
}

/** Mirrors the skeleton's EvaluationRun row. */
export class WorkEvaluationRunResponseDto {
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

export class ListWorkEvaluationRunsResponseDto extends CommonListResponseDto<WorkEvaluationRunResponseDto> {}

export class ListWorkEvaluationResultsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Subject whose results are listed (newest first)" })
  @IsUUID()
  subjectId!: string;

  @ApiPropertyOptional({ description: "Restrict to one criteria version" })
  @IsOptional()
  @IsUUID()
  criteriaVersionId?: string;
}

/** Mirrors the skeleton's EvaluationResult read shape (manifest excluded). */
export class WorkEvaluationResultResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() runId!: string;
  @ApiProperty() subjectId!: string;
  @ApiProperty() criteriaVersionId!: string;
  @ApiProperty({ description: "SHA-256 over the canonical manifest" }) contentHash!: string;
  @ApiProperty({ type: Object, description: "{ evaluated, declaredUnlinked, skipped } coverage buckets" })
  coverageStats!: object;
  @ApiProperty({ type: Object, isArray: true, description: "Scored verdicts by criterionKey" })
  verdicts!: object[];
  @ApiPropertyOptional() summary?: string | null;
  @ApiPropertyOptional({
    type: Object,
    description: "Judgment execution facts: model, scope, promptVersion, tokenUsage",
  })
  metadata?: object | null;
  @ApiProperty() createdAt!: Date;
}

export class ListWorkEvaluationResultsResponseDto extends CommonListResponseDto<WorkEvaluationResultResponseDto> {}

export class ListWorkEvaluationSubjectsRequestDto extends CommonListRequestDto {
  @ApiProperty({ description: "Host-assigned scope type the subjects are listed under" })
  @IsString()
  @IsNotEmpty()
  scopeType!: string;

  @ApiProperty({ description: "Host-assigned scope id the subjects are listed under" })
  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}

/** Mirrors the skeleton's EvaluationSubject row (kind is always "work" here). */
export class WorkEvaluationSubjectResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() scopeType!: string;
  @ApiProperty() scopeId!: string;
  @ApiProperty() subjectKey!: string;
  @ApiProperty() displayName!: string;
  @ApiPropertyOptional({ type: Object }) metadata?: object | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class ListWorkEvaluationSubjectsResponseDto extends CommonListResponseDto<WorkEvaluationSubjectResponseDto> {}
